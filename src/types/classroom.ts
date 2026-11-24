export interface ClassroomMember {
  classroom_id: string;
  student_id: string;
  joined_at: string;
  full_name: string;
  school_name: string | null;
  classroom: string | null;
}

export interface ClassroomWithDetails {
  id: string;
  teacher_id: string;
  teacher_name: string;
  name: string;
  grade: number | null;
  invite_code: string;
  created_at: string;
  members: ClassroomMember[];
}

export interface StudentEnrolledClassroom {
  classroom_id: string;
  name: string;
  grade: number | null;
  invite_code: string;
  teacher_name: string;
  joined_at: string;
}