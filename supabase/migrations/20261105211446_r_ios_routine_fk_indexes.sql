create index if not exists routine_evaluations_pattern_user_idx
  on public.routine_evaluations (pattern_id, user_id);

create index if not exists routine_discoveries_pattern_user_idx
  on public.routine_discoveries (pattern_id, user_id);
create index if not exists routine_discoveries_evaluation_user_idx
  on public.routine_discoveries (evaluation_id, user_id);

create index if not exists routines_discovery_user_idx
  on public.routines (discovery_id, user_id);
create index if not exists routines_pattern_user_idx
  on public.routines (pattern_id, user_id);

create index if not exists routine_experiments_routine_user_idx
  on public.routine_experiments (routine_id, user_id);

create index if not exists routine_feedback_user_idx
  on public.routine_feedback (user_id);
create index if not exists routine_feedback_discovery_user_idx
  on public.routine_feedback (discovery_id, user_id);
create index if not exists routine_feedback_routine_user_idx
  on public.routine_feedback (routine_id, user_id);
create index if not exists routine_feedback_experiment_user_idx
  on public.routine_feedback (experiment_id, user_id);
