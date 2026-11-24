import type {
  ExamDataset,
  ParticipationType,
  RankedParticipant,
  ShadowRankingSummary,
  Student,
  StudentAnswer,
} from '../types/exam';

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

/**
 * Sıralama tablosunda diğer öğrencilerin gizliliği için soyadı maskeler ("Ahmet Y.").
 */
export function maskStudentName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return parts[0] || 'Öğrenci';
  const first = parts[0];
  const lastInitial = parts[parts.length - 1][0]?.toUpperCase() ?? '';
  return `${first} ${lastInitial}.`;
}

function buildScoredParticipants(dataset: ExamDataset): RankedParticipant[] {
  const questionCorrectMap = new Map(
    dataset.questions.map((q) => [q.id, q.correct_option])
  );
  const totalQuestions = dataset.questions.length;
  const penalty = dataset.exam.wrong_penalty_ratio;

  const answersByStudent = new Map<string, StudentAnswer[]>();
  for (const ans of dataset.answers) {
    const list = answersByStudent.get(ans.student_id) ?? [];
    list.push(ans);
    answersByStudent.set(ans.student_id, list);
  }

  return dataset.students.map((stu: Student) => {
    const stuAnswers = answersByStudent.get(stu.id) ?? [];
    let correct = 0;
    let wrong = 0;
    let blank = 0;

    const answeredIds = new Set<string>();
    for (const ans of stuAnswers) {
      const correctOpt = questionCorrectMap.get(ans.question_id);
      if (!correctOpt) continue;
      answeredIds.add(ans.question_id);

      if (ans.selected_option === null) {
        blank++;
      } else if (ans.selected_option === correctOpt) {
        correct++;
      } else {
        wrong++;
      }
    }

    // Cevap satırı hiç oluşmamış soruları boş say
    const missingCount = Math.max(0, totalQuestions - answeredIds.size);
    blank += missingCount;

    const net = round2(correct - wrong * penalty);
    const successRate =
      totalQuestions > 0 ? Math.round((correct / totalQuestions) * 100) : 0;
    const pType: ParticipationType = stu.participation_type ?? 'OFFICIAL';

    return {
      student_id: stu.id,
      full_name: stu.full_name,
      masked_name: maskStudentName(stu.full_name),
      classroom: stu.classroom,
      school_name: stu.school_name ?? null,
      participation_type: pType,
      correct_count: correct,
      wrong_count: wrong,
      blank_count: blank,
      net_score: net,
      success_rate: successRate,
      rank: 1,
    };
  });
}

function sortAndAssignRanks(items: RankedParticipant[]): RankedParticipant[] {
  const sorted = [...items].sort((a, b) => {
    if (b.net_score !== a.net_score) return b.net_score - a.net_score;
    if (b.correct_count !== a.correct_count) {
      return b.correct_count - a.correct_count;
    }
    return a.wrong_count - b.wrong_count;
  });

  // Eşit netli öğrenciler aynı sırayı paylaşır (standart yarışma sıralaması: 1, 2, 2, 4)
  return sorted.map((item, idx) => {
    if (idx === 0) return { ...item, rank: 1 };
    const prev = sorted[idx - 1];
    const isTie =
      prev.net_score === item.net_score &&
      prev.correct_count === item.correct_count &&
      prev.wrong_count === item.wrong_count;

    return {
      ...item,
      rank: isTie ? idx : idx + 1,
    };
  });
}

/**
 * Verilen öğrenci için:
 * - Resmi katılımcıysa resmi havuzdaki kendi sırasını,
 * - Misafir katılımcıysa resmi havuzu kirletmeden "girmiş olsaydı" alacağı gölge sırasını,
 * - Her iki durumda da tüm katılımcıları kapsayan Büyük Sıralamayı hesaplar.
 */
export function calculateShadowRanking(
  dataset: ExamDataset,
  targetStudentId: string
): ShadowRankingSummary | null {
  const allScored = buildScoredParticipants(dataset);
  const grandLeaderboard = sortAndAssignRanks(allScored);
  const target = grandLeaderboard.find((p) => p.student_id === targetStudentId);

  if (!target) return null;

  const officialOnly = allScored.filter(
    (p) => p.participation_type === 'OFFICIAL'
  );
  const guestCount = allScored.length - officialOnly.length;
  const officialLeaderboard = sortAndAssignRanks(officialOnly);

  const officialAvgNet =
    officialLeaderboard.length > 0
      ? round2(
          officialLeaderboard.reduce((s, p) => s + p.net_score, 0) /
            officialLeaderboard.length
        )
      : 0;

  const grandAvgNet =
    grandLeaderboard.length > 0
      ? round2(
          grandLeaderboard.reduce((s, p) => s + p.net_score, 0) /
            grandLeaderboard.length
        )
      : 0;

  let shadowOrOfficialRank: number | null = null;
  let shadowPoolSize = officialLeaderboard.length;
  let shadowPercentile: number | null = null;

  if (target.participation_type === 'OFFICIAL') {
    const foundOfficial = officialLeaderboard.find(
      (p) => p.student_id === targetStudentId
    );
    shadowOrOfficialRank = foundOfficial?.rank ?? null;
    shadowPoolSize = officialLeaderboard.length;
    if (shadowOrOfficialRank !== null && shadowPoolSize > 0) {
      shadowPercentile = Math.max(
        1,
        Math.round((shadowOrOfficialRank / shadowPoolSize) * 100)
      );
    }
  } else {
    // MİSAFİR GÖLGE SIRALAMA: Resmi havuzdaki kaç öğrenci bu misafirden daha yüksek yaptı?
    if (officialLeaderboard.length > 0) {
      const strictlyHigherOfficialCount = officialLeaderboard.filter(
        (p) =>
          p.net_score > target.net_score ||
          (p.net_score === target.net_score &&
            p.correct_count > target.correct_count)
      ).length;

      shadowOrOfficialRank = strictlyHigherOfficialCount + 1;
      shadowPoolSize = officialLeaderboard.length + 1;
      shadowPercentile = Math.max(
        1,
        Math.round((shadowOrOfficialRank / shadowPoolSize) * 100)
      );
    }
  }

  const grandPercentile =
    grandLeaderboard.length > 0
      ? Math.max(1, Math.round((target.rank / grandLeaderboard.length) * 100))
      : 100;

  return {
    target,
    official_count: officialLeaderboard.length,
    guest_count: guestCount,
    total_count: grandLeaderboard.length,
    official_avg_net: officialAvgNet,
    grand_avg_net: grandAvgNet,
    shadow_or_official_rank: shadowOrOfficialRank,
    shadow_pool_size: shadowPoolSize,
    shadow_percentile: shadowPercentile,
    grand_rank: target.rank,
    grand_percentile: grandPercentile,
    official_leaderboard: officialLeaderboard,
    grand_leaderboard: grandLeaderboard,
  };
}