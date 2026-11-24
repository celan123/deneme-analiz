const EXAM_WORDS = [
  'ALAN', 'ALEV', 'ARPA', 'ARZU', 'AYNA', 'AYVA', 'BALE', 'BORA', 'BOYA',
  'DAMA', 'DEPO', 'DERS', 'DEVA', 'DOST', 'EBRU', 'EFOR', 'EKOL', 'ELMA',
  'EMEL', 'ESER', 'ETAP', 'FARK', 'FUAR', 'GALA', 'GOLF', 'GRUP', 'HALE',
  'HANE', 'HAVA', 'HECE', 'KALE', 'KAMP', 'KANO', 'KARE', 'KART', 'KASA',
  'KAYA', 'KENT', 'KONU', 'KORO', 'KOTA', 'KOZA', 'KRAL', 'KUPA', 'KURS',
  'LALE', 'LENS', 'LOGO', 'MARS', 'MART', 'MASA', 'MAYA', 'MERT', 'MOLA',
  'NANE', 'NEON', 'NOTA', 'OBJE', 'OCAK', 'ODAK', 'OKUL', 'OLAY', 'ONAY',
  'ONUR', 'OPAL', 'ORAN', 'ORTA', 'OVAL', 'OYUN', 'OZAN', 'PANO', 'PARK',
  'PLAN', 'POTA', 'PUAN', 'PUMA', 'ROTA', 'SADE', 'SAHA', 'SEDA', 'SEMA',
  'SERA', 'SOLO', 'SORU', 'SPOR', 'STAR', 'TANE', 'TAZE', 'TEMA', 'TEPE',
  'TEST', 'TREN', 'TUNA', 'UFUK', 'ULAK', 'UMUT', 'USUL', 'UYUM', 'UZAY',
  'VAHA', 'VAZO', 'VEFA', 'VOLT', 'YURT', 'YUVA', 'ZARF', 'ZEKA',
] as const;

export function toAsciiUpper(text: string): string {
  return text
    .replace(/ç/gi, 'C')
    .replace(/ğ/gi, 'G')
    .replace(/ı/g, 'I')
    .replace(/i/g, 'I')
    .replace(/İ/g, 'I')
    .replace(/ö/gi, 'O')
    .replace(/ş/gi, 'S')
    .replace(/ü/gi, 'U')
    .toUpperCase();
}

export function generateExamCode(withNumericSuffix = false): string {
  const word = EXAM_WORDS[Math.floor(Math.random() * EXAM_WORDS.length)];
  if (!withNumericSuffix) {
    return `SNV-${word}`;
  }
  const num = Math.floor(10 + Math.random() * 90);
  return `SNV-${word}${num}`;
}