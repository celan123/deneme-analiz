export type OptionChoice = 'A' | 'B' | 'C' | 'D' | 'E' | null;
export type ValidOption = Exclude<OptionChoice, null>;
export type QuestionType = 'TEMEL' | 'YENI_NESIL';

// ==========================================
// 1. HAM VERİ MODELLERİ (Giriş / Veritabanı)
// ==========================================

export type ExamScope = 'NATIONAL' | 'CLASSROOM';
export type ExamStatus = 'DRAFT' | 'PUBLISHED' | 'CLOSED';

export interface Exam {
  starts_at?: string | null;
  ends_at?: string | null;
  assigned_classroom_ids?: string[];
  official_count?: number;
  guest_count?: number;
  id: string;
  title: string;
  exam_date: string;
  wrong_penalty_ratio: number;
  exam_scope?: ExamScope;
  allow_guests?: boolean;
  status?: ExamStatus;
  show_solutions_after_finish?: boolean;
  duration_minutes?: number | null;
  classroom_id?: string | null;
  owner_id?: string | null;
  grade?: number | null;
  exam_code?: string | null;
  participant_count?: number;
}

export interface Question {
  id: string;
  exam_id: string;
  question_number: number;
  subject: string;
  outcome_code: string;
  outcome_title: string;
  correct_option: ValidOption;
  question_type?: QuestionType;
  question_text?: string;
  options?: Partial<Record<ValidOption, string>>;
  // Soru ajanından gelen ek alanlar
  grade?: number | null;
  unit?: string | null;
  difficulty?: string | null;
  svg_code?: string | null;
  solution?: string | null;
  distractor_analysis?: Partial<Record<ValidOption, string>> | null;
}
export type ParticipationType = 'OFFICIAL' | 'GUEST';

export interface Student {
  id: string;
  full_name: string;
  classroom: string;
  participation_type?: ParticipationType;
  school_name?: string | null;
}

export interface StudentAnswer {
  exam_id: string;
  student_id: string;
  question_id: string;
  selected_option: OptionChoice;
  time_spent_seconds?: number; // Opsiyonel (Faz 2): Soruda harcanan süre (saniye)
  change_count?: number;       // Opsiyonel (Faz 2): Şık değiştirme sayısı
}

export interface ExamDataset {
  exam: Exam;
  questions: Question[];
  students: Student[];
  answers: StudentAnswer[];
}

// ==========================================
// 2. ANALİZ ÇIKTI MODELLERİ (Raporlama)
// ==========================================

// Modül 1 Çıktısı: Kazanım Hakimiyet Analizi
export interface OutcomeAnalysis {
  outcome_code: string;
  outcome_title: string;
  subject: string;
  question_numbers: number[];
  success_rate: number;        // Doğru yapılma %'si (0 - 100)
  wrong_rate: number;          // Yanlış yapılma %'si (Kavram yanılgısı göstergesi)
  blank_rate: number;          // Boş bırakılma %'si (Konu eksikliği / süre göstergesi)
  average_net: number;         // Bu kazanımdaki öğrenci başı ortalama net
}

// Modül 2 Çıktısı: Sorular Arası Korelasyon Matrisi
export interface QuestionCorrelation {
  source_question: number;
  target_question: number;
  conditional_probability: number; // Kaynağı çözenlerin hedefi çözme %'si
  phi_coefficient: number;         // -1 ile +1 arası yapısal ilişki katsayısı
}

// Modül 3 Çıktısı: Madde Kalitesi ve Çeldirici Analizi
export interface DistractorStat {
  option: ValidOption;
  is_correct: boolean;
  total_count: number;
  total_percentage: number;
  upper_group_count: number;       // Üst %27'lik başarılı grupta işaretleyen sayısı
  lower_group_count: number;       // Alt %27'lik grupta işaretleyen sayısı
  is_dead_distractor: boolean;     // Hiç kimse işaretlememiş mi?
  is_misleading_upper: boolean;    // Üst grubu alt gruptan fazla tuzağa düşürmüş mü?
}

export type ItemQualityStatus =
  | 'EXCELLENT'       // r >= 0.40 (Çok iyi ayırt edici soru)
  | 'GOOD'            // 0.30 <= r < 0.40 (İyi soru)
  | 'NEEDS_REVISION'  // 0.20 <= r < 0.30 (Çeldiricileri gözden geçirilmeli)
  | 'WEAK'            // 0.00 <= r < 0.20 (Ayırt ediciliği çok düşük)
  | 'DEFECTIVE';      // r < 0 (Hatalı soru veya yanlış cevap anahtarı alarmı)

export interface ItemQualityAnalysis {
  question_id: string;
  question_number: number;
  outcome_code: string;
  outcome_title: string;
  correct_option: ValidOption;
  difficulty_index: number;        // p (0.00 - 1.00 arası güçlük indeksi)
  discrimination_index: number;    // r_jx (-1.00 ile +1.00 arası ayırt edicilik)
  blank_count: number;
  blank_rate: number;
  quality_status: ItemQualityStatus;
  strongest_distractor: ValidOption | null; // Öğrencileri en çok çeken yanlış şık
  options: DistractorStat[];
}
// Modül 4 Çıktısı: Süre ve Davranış Telemetrisi
export type BehaviorFlag =
  | 'NORMAL'
  | 'TIME_TRAP'        // Uzun süre harcanıp düşük başarı alınan zaman tuzağı
  | 'RAPID_GUESSING'   // Çok kısa sürede işaretlenen (sallama şüphesi) soru
  | 'HIGH_HESITATION'; // Yüksek şık değiştirme / kararsızlık oranı

export interface QuestionTelemetryAnalysis {
  question_id: string;
  question_number: number;
  outcome_code: string;
  outcome_title: string;
  tracked_count: number;            // Süre kaydı olan öğrenci sayısı
  avg_time_seconds: number;         // Soru başı ortalama süre (sn)
  avg_time_correct: number | null;  // Doğru yapanların ortalama süresi (sn)
  avg_time_wrong: number | null;    // Yanlış yapanların ortalama süresi (sn)
  rapid_guess_count: number;        // 6 sn altında işaretleyen öğrenci sayısı
  rapid_guess_rate: number;         // Hızlı işaretleme yüzdesi
  total_changes: number;            // Bu sorudaki toplam şık değiştirme sayısı
  hesitation_rate: number;          // En az 1 kez şık değiştiren öğrenci %'si
  tracked_success_rate: number;     // Telemetrisi ölçülen gruptaki doğru %'si
  behavior_flag: BehaviorFlag;
}

export interface TelemetryReport {
  tracked_student_count: number;    // Telemetri verisi bulunan öğrenci sayısı
  overall_avg_question_time: number; // Sınav geneli soru başı ortalama süre (sn)
  total_rapid_guesses: number;      // Toplam hızlı işaretleme sayısı
  total_option_changes: number;     // Toplam şık değiştirme sayısı
  questions: QuestionTelemetryAnalysis[];
}
// Soru Havuzu Ajanının ürettiği ham JSON şeması
export interface AgentQuestionInput {
  id?: string;
  sinif?: number;
  ders: string;
  unite?: string;
  kazanimKodu: string;
  kazanimAdi: string;
  zorluk?: string;
  soruMetni: string;
  gorselGerekliMi?: boolean;
  svgKodu?: string | null;
  secenekler: Partial<Record<ValidOption, string>>;
  dogruCevap: string;
  cozum?: string;
  celdiriciAnalizi?: Partial<Record<ValidOption, string>>;
}
// Merkezi Soru Havuzu kaydı (sınavdan bağımsız)
export interface PoolQuestion {
  id: string;
  subject: string;
  grade: number | null;
  unit: string | null;
  outcome_code: string;
  outcome_title: string;
  difficulty: string | null;
  question_type?: QuestionType | null;
  question_text: string | null;
  options: Partial<Record<ValidOption, string>> | null;
  correct_option: ValidOption;
  svg_code: string | null;
  solution: string | null;
  distractor_analysis: Partial<Record<ValidOption, string>> | null;
  calibrated_difficulty?: number | null;
  calibrated_discrimination?: number | null;
  attempt_count?: number;
  created_at?: string;
}
export interface RankedParticipant {
  student_id: string;
  full_name: string;
  masked_name: string;
  classroom: string;
  school_name: string | null;
  participation_type: ParticipationType;
  correct_count: number;
  wrong_count: number;
  blank_count: number;
  net_score: number;
  success_rate: number;
  rank: number;
}

export interface ShadowRankingSummary {
  target: RankedParticipant;
  official_count: number;
  guest_count: number;
  total_count: number;
  official_avg_net: number;
  grand_avg_net: number;
  /**
   * OFFICIAL öğrenci için resmi havuzdaki kendi sırası.
   * GUEST öğrenci için resmi ortalamayı bozmadan "girmiş olsaydı" alacağı gölge sıra.
   */
  shadow_or_official_rank: number | null;
  shadow_pool_size: number;
  shadow_percentile: number | null;
  grand_rank: number;
  grand_percentile: number;
  official_leaderboard: RankedParticipant[];
  grand_leaderboard: RankedParticipant[];
  
}
export interface StudentCompletedAttempt {
  exam_id: string;
  student_id: string;
  participation_type: ParticipationType;
  created_at: string;
}
