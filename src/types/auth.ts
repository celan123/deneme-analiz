export type UserRole = 'admin' | 'teacher' | 'student';

export interface UserProfile {
  id: string;
  full_name: string;
  role: UserRole;
  school_name: string | null;
  grade: number | null;
  classroom: string | null;
}