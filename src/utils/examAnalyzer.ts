import type {
  BehaviorFlag,
  DistractorStat,
  ExamDataset,
  ItemQualityAnalysis,
  ItemQualityStatus,
  OptionChoice,
  OutcomeAnalysis,
  QuestionCorrelation,
  QuestionTelemetryAnalysis,
  StudentAnswer,
  TelemetryReport,
  ValidOption,
} from '../types/exam';

/**
 * YARDIMCI 1: Öğrenci cevaplarını O(1) hızında erişilebilir belleğe (Map) alır.
 * C# karşılığı: Dictionary<string, Dictionary<string, OptionChoice>>
 */
function buildAnswerLookup(
  dataset: ExamDataset
): Map<string, Map<string, OptionChoice>> {
  const lookup = new Map<string, Map<string, OptionChoice>>();

  for (const ans of dataset.answers) {
    let studentMap = lookup.get(ans.student_id);
    if (!studentMap) {
      studentMap = new Map<string, OptionChoice>();
      lookup.set(ans.student_id, studentMap);
    }
    studentMap.set(ans.question_id, ans.selected_option);
  }

  return lookup;
}

/**
 * YARDIMCI 2: Ondalıklı sayıları istenen basamağa yuvarlar.
 */
function roundTo(value: number, decimals: number = 1): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * ============================================================================
 * MODÜL 1: KAZANIM HAKİMİYET VE TELAFİ ÖNCELİĞİ ANALİZİ
 * ============================================================================
 * Soruları kazanım koduna göre gruplar; doğru, yanlış ve boş oranlarını hesaplar.
 * Çıktıyı en düşük başarıdan en yükseğe sıralar.
 */
export function analyzeOutcomes(
  dataset: ExamDataset,
  classroomFilter?: string
): OutcomeAnalysis[] {
  const targetStudents = classroomFilter
    ? dataset.students.filter((s) => s.classroom === classroomFilter)
    : dataset.students;

  if (targetStudents.length === 0 || dataset.questions.length === 0) {
    return [];
  }

  const answerLookup = buildAnswerLookup(dataset);

  const outcomeGroups = new Map<
    string,
    {
      outcome_title: string;
      subject: string;
      questions: typeof dataset.questions;
    }
  >();

  for (const question of dataset.questions) {
    const existing = outcomeGroups.get(question.outcome_code);
    if (existing) {
      existing.questions.push(question);
    } else {
      outcomeGroups.set(question.outcome_code, {
        outcome_title: question.outcome_title,
        subject: question.subject,
        questions: [question],
      });
    }
  }

  const results: OutcomeAnalysis[] = [];

  for (const [outcomeCode, group] of outcomeGroups.entries()) {
    let correctCount = 0;
    let wrongCount = 0;
    let blankCount = 0;

    for (const student of targetStudents) {
      const studentAnswers = answerLookup.get(student.id);

      for (const question of group.questions) {
        const selected = studentAnswers?.get(question.id) ?? null;

        if (selected === null) {
          blankCount++;
        } else if (selected === question.correct_option) {
          correctCount++;
        } else {
          wrongCount++;
        }
      }
    }

    const totalAttempts = targetStudents.length * group.questions.length;
    const totalNet =
      correctCount - wrongCount * dataset.exam.wrong_penalty_ratio;

    results.push({
      outcome_code: outcomeCode,
      outcome_title: group.outcome_title,
      subject: group.subject,
      question_numbers: group.questions
        .map((q) => q.question_number)
        .sort((a, b) => a - b),
      success_rate: roundTo((correctCount / totalAttempts) * 100, 1),
      wrong_rate: roundTo((wrongCount / totalAttempts) * 100, 1),
      blank_rate: roundTo((blankCount / totalAttempts) * 100, 1),
      average_net: roundTo(totalNet / targetStudents.length, 2),
    });
  }

  return results.sort((a, b) => a.success_rate - b.success_rate);
}

/**
 * ============================================================================
 * MODÜL 2: SORULAR ARASI KORELASYON VE ÖN KOŞUL MATRİSİ
 * ============================================================================
 * Her soru çifti için Koşullu Olasılık P(Hedef|Kaynak) ve Phi Katsayısını hesaplar.
 */
export function calculateQuestionCorrelations(
  dataset: ExamDataset,
  classroomFilter?: string
): QuestionCorrelation[] {
  const targetStudents = classroomFilter
    ? dataset.students.filter((s) => s.classroom === classroomFilter)
    : dataset.students;

  if (targetStudents.length === 0 || dataset.questions.length < 2) {
    return [];
  }

  const answerLookup = buildAnswerLookup(dataset);
  const sortedQuestions = [...dataset.questions].sort(
    (a, b) => a.question_number - b.question_number
  );

  const correctnessMatrix = new Map<string, boolean[]>();
  for (const question of sortedQuestions) {
    const scores = targetStudents.map((student) => {
      const selected = answerLookup.get(student.id)?.get(question.id) ?? null;
      return selected === question.correct_option;
    });
    correctnessMatrix.set(question.id, scores);
  }

  const correlations: QuestionCorrelation[] = [];

  for (let i = 0; i < sortedQuestions.length; i++) {
    const sourceQ = sortedQuestions[i];
    const sourceScores = correctnessMatrix.get(sourceQ.id)!;

    for (let j = 0; j < sortedQuestions.length; j++) {
      if (i === j) continue;

      const targetQ = sortedQuestions[j];
      const targetScores = correctnessMatrix.get(targetQ.id)!;

      let n11 = 0; // İkisi de doğru
      let n10 = 0; // Kaynak doğru, hedef yanlış/boş
      let n01 = 0; // Kaynak yanlış/boş, hedef doğru
      let n00 = 0; // İkisi de yanlış/boş

      for (let s = 0; s < targetStudents.length; s++) {
        const srcCorrect = sourceScores[s];
        const tgtCorrect = targetScores[s];

        if (srcCorrect && tgtCorrect) n11++;
        else if (srcCorrect && !tgtCorrect) n10++;
        else if (!srcCorrect && tgtCorrect) n01++;
        else n00++;
      }

      const sourceCorrectTotal = n11 + n10;
      const conditionalProbability =
        sourceCorrectTotal > 0 ? (n11 / sourceCorrectTotal) * 100 : 0;

      const numerator = n11 * n00 - n10 * n01;
      const denominator = Math.sqrt(
        (n11 + n10) * (n01 + n00) * (n11 + n01) * (n10 + n00)
      );

      const phiCoefficient = denominator > 0 ? numerator / denominator : 0;

      correlations.push({
        source_question: sourceQ.question_number,
        target_question: targetQ.question_number,
        conditional_probability: roundTo(conditionalProbability, 1),
        phi_coefficient: roundTo(phiCoefficient, 2),
      });
    }
  }

  return correlations;
}

/**
 * ============================================================================
 * MODÜL 3: MADDE (SORU) KALİTESİ VE ÇELDİRİCİ ANALİZİ
 * ============================================================================
 * %27 Alt-Üst Grup yöntemiyle Madde Güçlük (p), Ayırt Edicilik (r_jx) ve
 * şık bazlı çeldirici istatistiklerini hesaplar.
 */
export function analyzeItemQuality(
  dataset: ExamDataset,
  classroomFilter?: string
): ItemQualityAnalysis[] {
  const targetStudents = classroomFilter
    ? dataset.students.filter((s) => s.classroom === classroomFilter)
    : dataset.students;

  if (targetStudents.length === 0 || dataset.questions.length === 0) {
    return [];
  }

  // Sınavın 4 şıklı (LGS) mı yoksa 5 şıklı (YKS) mı olduğunu otomatik algıla
  const hasOptionE =
    dataset.questions.some((q) => q.correct_option === 'E') ||
    dataset.answers.some((a) => a.selected_option === 'E');

  const availableOptions: ValidOption[] = hasOptionE
    ? ['A', 'B', 'C', 'D', 'E']
    : ['A', 'B', 'C', 'D'];

  const answerLookup = buildAnswerLookup(dataset);

  // 1. Öğrencileri genel sınav netlerine göre sırala (%27 Üst ve Alt grup için)
  const studentScores = targetStudents.map((student) => {
    let correct = 0;
    let wrong = 0;
    const sAnswers = answerLookup.get(student.id);

    for (const question of dataset.questions) {
      const selected = sAnswers?.get(question.id) ?? null;
      if (selected === null) continue;
      if (selected === question.correct_option) correct++;
      else wrong++;
    }

    const netScore = correct - wrong * dataset.exam.wrong_penalty_ratio;
    return { studentId: student.id, netScore };
  });

  studentScores.sort((a, b) => b.netScore - a.netScore);

  const groupSize = Math.max(1, Math.round(studentScores.length * 0.27));
  const upperGroupIds = new Set(
    studentScores.slice(0, groupSize).map((s) => s.studentId)
  );
  const lowerGroupIds = new Set(
    studentScores.slice(-groupSize).map((s) => s.studentId)
  );

  // 2. Her soru için güçlük, ayırt edicilik ve şık dağılımını çıkar
  const sortedQuestions = [...dataset.questions].sort(
    (a, b) => a.question_number - b.question_number
  );

  return sortedQuestions.map((question) => {
    let totalCorrect = 0;
    let blankCount = 0;
    let upperCorrect = 0;
    let lowerCorrect = 0;

    const optionCounts = new Map<
      ValidOption,
      { total: number; upper: number; lower: number }
    >();
    for (const opt of availableOptions) {
      optionCounts.set(opt, { total: 0, upper: 0, lower: 0 });
    }

    for (const student of targetStudents) {
      const selected =
        answerLookup.get(student.id)?.get(question.id) ?? null;

      if (selected === null) {
        blankCount++;
        continue;
      }

      const counter = optionCounts.get(selected);
      if (counter) {
        counter.total++;
        if (upperGroupIds.has(student.id)) counter.upper++;
        if (lowerGroupIds.has(student.id)) counter.lower++;
      }

      if (selected === question.correct_option) {
        totalCorrect++;
        if (upperGroupIds.has(student.id)) upperCorrect++;
        if (lowerGroupIds.has(student.id)) lowerCorrect++;
      }
    }

    const difficultyIndex = roundTo(totalCorrect / targetStudents.length, 2);
    const discriminationIndex = roundTo(
      (upperCorrect - lowerCorrect) / groupSize,
      2
    );

    let qualityStatus: ItemQualityStatus = 'WEAK';
    if (discriminationIndex < 0) qualityStatus = 'DEFECTIVE';
    else if (discriminationIndex >= 0.4) qualityStatus = 'EXCELLENT';
    else if (discriminationIndex >= 0.3) qualityStatus = 'GOOD';
    else if (discriminationIndex >= 0.2) qualityStatus = 'NEEDS_REVISION';

    const options: DistractorStat[] = availableOptions.map((opt) => {
      const counts = optionCounts.get(opt)!;
      const isCorrect = opt === question.correct_option;

      return {
        option: opt,
        is_correct: isCorrect,
        total_count: counts.total,
        total_percentage: roundTo(
          (counts.total / targetStudents.length) * 100,
          1
        ),
        upper_group_count: counts.upper,
        lower_group_count: counts.lower,
        is_dead_distractor: !isCorrect && counts.total === 0,
        is_misleading_upper: !isCorrect && counts.upper > counts.lower,
      };
    });

    // En çok öğrenciyi tuzağa düşüren yanlış şıkkı tespit et
    const wrongOptions = options.filter(
      (o) => !o.is_correct && o.total_count > 0
    );
    wrongOptions.sort((a, b) => b.total_count - a.total_count);
    const strongestDistractor =
      wrongOptions.length > 0 ? wrongOptions[0].option : null;

    return {
      question_id: question.id,
      question_number: question.question_number,
      outcome_code: question.outcome_code,
      outcome_title: question.outcome_title,
      correct_option: question.correct_option,
      difficulty_index: difficultyIndex,
      discrimination_index: discriminationIndex,
      blank_count: blankCount,
      blank_rate: roundTo((blankCount / targetStudents.length) * 100, 1),
      quality_status: qualityStatus,
      strongest_distractor: strongestDistractor,
      options,
    };
  });
}
/**
 * YARDIMCI 3: Şık bilgisinin yanında süre ve değişiklik sayaçlarına da O(1) erişim sağlar.
 */
function buildFullAnswerLookup(
  dataset: ExamDataset
): Map<string, Map<string, StudentAnswer>> {
  const lookup = new Map<string, Map<string, StudentAnswer>>();

  for (const ans of dataset.answers) {
    let studentMap = lookup.get(ans.student_id);
    if (!studentMap) {
      studentMap = new Map<string, StudentAnswer>();
      lookup.set(ans.student_id, studentMap);
    }
    studentMap.set(ans.question_id, ans);
  }

  return lookup;
}

/**
 * ============================================================================
 * MODÜL 4: SÜRE VE DAVRANIŞ TELEMETRİSİ ANALİZİ
 * ============================================================================
 * Öğrencilerin soruda harcadığı süre ve şık değiştirme davranışlarından
 * zaman tuzağı, hızlı sallama ve kararsızlık sinyallerini çıkarır.
 */
export function analyzeBehaviorTelemetry(
  dataset: ExamDataset,
  classroomFilter?: string,
  rapidGuessThresholdSeconds: number = 6
): TelemetryReport {
  const targetStudents = classroomFilter
    ? dataset.students.filter((s) => s.classroom === classroomFilter)
    : dataset.students;

  const fullLookup = buildFullAnswerLookup(dataset);

  // Yalnızca telemetri (süre) kaydı bulunan öğrencileri ayır
  const trackedStudents = targetStudents.filter((student) => {
    const sMap = fullLookup.get(student.id);
    if (!sMap) return false;
    for (const ans of sMap.values()) {
      if (typeof ans.time_spent_seconds === 'number') return true;
    }
    return false;
  });

  if (trackedStudents.length === 0 || dataset.questions.length === 0) {
    return {
      tracked_student_count: 0,
      overall_avg_question_time: 0,
      total_rapid_guesses: 0,
      total_option_changes: 0,
      questions: [],
    };
  }

  const sortedQuestions = [...dataset.questions].sort(
    (a, b) => a.question_number - b.question_number
  );

  let grandTotalTime = 0;
  let grandTotalTrackedAnswers = 0;
  let grandTotalRapidGuesses = 0;
  let grandTotalOptionChanges = 0;

  // 1. Geçiş: Ham telemetri istatistiklerini soru bazında topla
  const rawStats = sortedQuestions.map((question) => {
    let trackedCount = 0;
    let totalTime = 0;
    let correctTimeSum = 0;
    let correctCount = 0;
    let wrongTimeSum = 0;
    let wrongCount = 0;
    let rapidGuessCount = 0;
    let totalChanges = 0;
    let hesitantStudentCount = 0;

    for (const student of trackedStudents) {
      const ans = fullLookup.get(student.id)?.get(question.id);
      if (!ans || typeof ans.time_spent_seconds !== 'number') continue;

      const time = ans.time_spent_seconds;
      const changes = ans.change_count ?? 0;
      const selected = ans.selected_option;

      trackedCount++;
      totalTime += time;
      totalChanges += changes;

      if (changes > 0) hesitantStudentCount++;

      // Boş bırakılmamış ve eşik sürenin altında işaretlenmişse hızlı tahmin say
      if (selected !== null && time < rapidGuessThresholdSeconds) {
        rapidGuessCount++;
      }

      if (selected === question.correct_option) {
        correctCount++;
        correctTimeSum += time;
      } else if (selected !== null) {
        wrongCount++;
        wrongTimeSum += time;
      }
    }

    grandTotalTime += totalTime;
    grandTotalTrackedAnswers += trackedCount;
    grandTotalRapidGuesses += rapidGuessCount;
    grandTotalOptionChanges += totalChanges;

    return {
      question,
      trackedCount,
      avgTime: trackedCount > 0 ? roundTo(totalTime / trackedCount, 1) : 0,
      avgTimeCorrect:
        correctCount > 0 ? roundTo(correctTimeSum / correctCount, 1) : null,
      avgTimeWrong:
        wrongCount > 0 ? roundTo(wrongTimeSum / wrongCount, 1) : null,
      rapidGuessCount,
      rapidGuessRate:
        trackedCount > 0 ? roundTo((rapidGuessCount / trackedCount) * 100, 1) : 0,
      totalChanges,
      hesitationRate:
        trackedCount > 0
          ? roundTo((hesitantStudentCount / trackedCount) * 100, 1)
          : 0,
      trackedSuccessRate:
        trackedCount > 0 ? roundTo((correctCount / trackedCount) * 100, 1) : 0,
    };
  });

  const overallAvgQuestionTime =
    grandTotalTrackedAnswers > 0
      ? roundTo(grandTotalTime / grandTotalTrackedAnswers, 1)
      : 0;

  // 2. Geçiş: Sınav genel ortalamasına göre davranış bayraklarını (Flag) ata
  const questions: QuestionTelemetryAnalysis[] = rawStats.map((stat) => {
    let flag: BehaviorFlag = 'NORMAL';

    const isTimeTrap =
      stat.trackedCount > 0 &&
      stat.avgTime >= Math.max(15, overallAvgQuestionTime * 1.35) &&
      stat.trackedSuccessRate < 65;

    const isRapidGuessing =
      stat.trackedCount > 0 &&
      stat.rapidGuessRate >= 30 &&
      stat.avgTime < rapidGuessThresholdSeconds + 2;

    const isHighHesitation = stat.trackedCount > 0 && stat.hesitationRate >= 35;

    if (isTimeTrap) {
      flag = 'TIME_TRAP';
    } else if (isRapidGuessing) {
      flag = 'RAPID_GUESSING';
    } else if (isHighHesitation) {
      flag = 'HIGH_HESITATION';
    }

    return {
      question_id: stat.question.id,
      question_number: stat.question.question_number,
      outcome_code: stat.question.outcome_code,
      outcome_title: stat.question.outcome_title,
      tracked_count: stat.trackedCount,
      avg_time_seconds: stat.avgTime,
      avg_time_correct: stat.avgTimeCorrect,
      avg_time_wrong: stat.avgTimeWrong,
      rapid_guess_count: stat.rapidGuessCount,
      rapid_guess_rate: stat.rapidGuessRate,
      total_changes: stat.totalChanges,
      hesitation_rate: stat.hesitationRate,
      tracked_success_rate: stat.trackedSuccessRate,
      behavior_flag: flag,
    };
  });

  return {
    tracked_student_count: trackedStudents.length,
    overall_avg_question_time: overallAvgQuestionTime,
    total_rapid_guesses: grandTotalRapidGuesses,
    total_option_changes: grandTotalOptionChanges,
    questions,
  };
}