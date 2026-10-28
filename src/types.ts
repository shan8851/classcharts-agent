// Raw ClassCharts response shapes: only the fields we use.
// Mapped from real parent-account responses (Oct 2026) and
// https://classchartsapi.github.io/api-docs/

export interface RawPupil {
  id: number;
  name: string;
  first_name: string;
  last_name: string;
  school_name: string;
  timezone: string;
  display_homework: boolean;
  display_timetable: boolean;
  homework_todo_count: number;
  homework_late_count: number;
}

export interface RawHomework {
  id: number;
  lesson: string;
  subject: string;
  teacher: string;
  homework_type: string;
  title: string;
  description: string;
  issue_date: string;
  due_date: string;
  completion_time_unit: string;
  completion_time_value: string;
  status: {
    state: string | null;
    ticked: "yes" | "no";
    mark: string | null;
  } | null;
  validated_links?: { link: string }[];
  validated_attachments?: { filename: string; file?: string }[];
}

export interface RawLesson {
  teacher_name: string;
  lesson_name: string;
  subject_name: string;
  is_alternative_lesson: boolean;
  period_name: string;
  period_number: string;
  room_name: string;
  date: string;
  start_time: string;
  end_time: string;
  note: string;
}

export interface TimetableMeta {
  dates: string[];
  timetable_dates: string[];
}

export interface ApiResponse<T, M = unknown> {
  success: number;
  error?: string;
  data: T;
  meta: M;
}
