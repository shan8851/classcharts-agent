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
  display_behaviour?: boolean;
  display_detentions?: boolean;
  display_announcements?: boolean;
  display_attendance?: boolean;
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

export interface RawAnnouncement {
  id: number;
  title: string;
  description: string | null;
  teacher_name: string;
  timestamp: string;
  sticky: "yes" | "no";
  priority_pinned: "yes" | "no";
  state: string | null; // "viewed" etc.
  requires_consent: "yes" | "no";
  consent: { consent_given?: "yes" | "no" | null } | null;
  attachments: { filename: string; url?: string }[] | null;
}

export interface RawActivityPoint {
  id: number;
  type: string; // "behaviour", "detention"…
  polarity: "positive" | "negative" | "blank" | null;
  reason: string;
  score: number;
  timestamp: string; // "YYYY-MM-DD HH:MM:SS", school local time
  lesson_name: string | null;
  teacher_name: string | null;
  note: string | null;
}

// From the community schema; not yet seen in a real response.
export interface RawDetention {
  id: number;
  attended: "yes" | "no" | "upscaled" | "pending" | string;
  date: string;
  time: string | null;
  length: number | null;
  location: string | null;
  notes: string | null;
  lesson?: { name?: string; subject?: { name?: string } } | null;
  lesson_pupil_behaviour?: { reason?: string } | null;
  teacher?: { title?: string; first_name?: string; last_name?: string } | null;
  detention_type?: { name?: string } | null;
}

export interface RawAttendanceSession {
  status: string; // present, late, absent, ...
  code: string;
  late_minutes: number | string;
}

export interface AttendanceMeta {
  percentage: number | string | null;
  percentage_singe_august: number | string | null; // sic
  sessions: string[];
}
