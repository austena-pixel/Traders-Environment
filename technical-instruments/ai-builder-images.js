(function(root){
  'use strict';
  const limits=Object.freeze({count:3,sourceBytes:12*1024*1024,uploadBytes:650000,imageBytes:750000,totalBytes:2000000,requestBytes:2900000,edge:2048,pixels:60000000});
  class ImageError extends Error{constructor(message,code='invalid_image',status=400){super(message);this.code=code;this.status=status}}
  function mime(bytes){
    if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return 'image/png';
    if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
    if(bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'image/webp';
    return null;
  }
  function validate(images){
    if(!Array.isArray(images)||images.length>limits.count)throw new ImageError('Use up to 3 reference images per conversation. Start New chat to use a different set.');
    let total=0;
    return images.map(image=>{
      if(!image||typeof image!=='object'||Array.isArray(image)||Object.keys(image).some(k=>!['name','dataUrl'].includes(k))||typeof image.name!=='string'||!image.name.trim()||image.name.length>180||typeof image.dataUrl!=='string')throw new ImageError('An image attachment is invalid. Attach it again.');
      const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl);
      if(!match||match[2].length%4)throw new ImageError('Attach a PNG, JPG or WebP image file. External image URLs are not supported.');
      if(match[2].length>Math.ceil(limits.imageBytes/3)*4)throw new ImageError('This image is too large after optimization. Use a smaller picture.','image_too_large',413);
      let bytes;
      try{
        bytes=typeof Buffer!=='undefined'?Buffer.from(match[2],'base64'):Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));
        if(typeof Buffer!=='undefined'&&bytes.toString('base64')!==match[2])throw Error();
      }catch{throw new ImageError('The image could not be read. Attach it again.')}
      if(mime(bytes)!==match[1])throw new ImageError('The file contents do not match a supported image type.');
      total+=bytes.length;
      if(bytes.length>limits.imageBytes||total>limits.totalBytes)throw new ImageError('The reference images are too large together. Use smaller pictures.','images_too_large',413);
      const name=image.name.replace(/[\u0000-\u001f\u007f]/g,'').trim();if(!name)throw new ImageError('An image needs a filename. Attach it again.');
      return {name,dataUrl:image.dataUrl};
    });
  }
  function dataUrl(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new ImageError('The image file could not be read.'));reader.readAsDataURL(blob)})}
  async function prepare(file){
    if(!file.size||file.size>limits.sourceBytes)throw new ImageError('Choose an image smaller than 12 MB.');
    const actual=mime(new Uint8Array(await file.slice(0,16).arrayBuffer()));
    if(!actual||(file.type&&file.type!==actual))throw new ImageError('Choose a valid PNG, JPG/JPEG or WebP image.');
    let bitmap;
    try{bitmap=await createImageBitmap(file)}catch{throw new ImageError('The image could not be opened. Choose another picture.')}
    try{
      if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>limits.pixels)throw new ImageError('This picture has too many pixels. Use a smaller version.');
      const name=(file.name||'Reference image').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,180)||'Reference image';
      if(file.size<=limits.uploadBytes&&Math.max(bitmap.width,bitmap.height)<=limits.edge){
        return {...validate([{name,dataUrl:await dataUrl(new Blob([file],{type:actual}))}])[0],optimized:false};
      }
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
      if(!ctx)throw new ImageError('Image optimization is unavailable in this browser.');
      let scale=Math.min(1,limits.edge/Math.max(bitmap.width,bitmap.height));
      for(let attempt=0;attempt<4;attempt++){
        canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
        ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
        for(const quality of [.94,.86,.78]){
          const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',quality));
          if(blob&&blob.size<=limits.uploadBytes)return {...validate([{name,dataUrl:await dataUrl(blob)}])[0],optimized:true};
        }
        scale*=.8;
      }
      throw new ImageError('This image could not be optimized. Crop the relevant setup and try again.');
    }finally{bitmap.close()}
  }
  const api=Object.freeze({limits,validate,prepare,ImageError});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TIOSAIImages=api;
})(typeof window!=='undefined'?window:globalThis);
