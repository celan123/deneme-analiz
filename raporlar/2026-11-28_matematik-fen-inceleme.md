# Matematik ve Fen Soru İncelemesi — 28.11.2026

Kapsam: `question_pool` içindeki **104 Matematik (5. sınıf)** ve **60 Fen Bilimleri (6. sınıf)** sorusu.
Yöntem: Her soru, SVG içindeki metinler dahil okundu; cevap anahtarı bağımsız olarak çözülüp `correct_option` ile karşılaştırıldı.

> Sınır: Şekle (koordinata) dayalı yaklaşık 10 geometri/sayı doğrusu sorusunda şeklin kendisi görülmedi; yalnızca verilen değerlere göre hesap doğrulandı.

## Özet

| | Matematik | Fen |
|---|---|---|
| İncelenen | 104 | 60 |
| **Yanlış cevap anahtarı** | **0** | **0** |
| Düzeltilmesi gereken (içerik) | 3 | 6 |
| Kopya soru (fazlalık) | 4 | 0 |
| Müfredat sınırı — öğretmen kontrolü | ~30 + 2 | — |
| SVG font < 18 (mobil) | 50 | **60 (tamamı)** |
| SVG oran < 2,1 | 44 | 3 |

Hesaplar ve bilimsel bilgiler genel olarak sağlam. Asıl sorunlar: **mobil SVG**, **birkaç belirsiz/çift doğrulu soru**, **tarihsel iddialar** ve **kopyalar**.

---

## FEN BİLİMLERİ — Düzeltilmesi gerekenler

| ID | Sorun | Öneri |
|---|---|---|
| `pool-1795729240625-1` | **Çift doğru riski.** Doğru cevap D ("Asteroit kuşağı Uranüs ile Dünya arasında yer alır" = yanlış ifade). Ama Güneş'e uzaklık bakımından kuşak gerçekten Dünya ile Uranüs yörüngeleri arasındadır; ifade savunulabilir. | D'yi "Asteroit kuşağı Dünya ile Mars arasında yer alır." yap. |
| `pool-1795729240625-43` | **Belirlenemez veri.** N için "M'den küçük, L'den büyük dış gezegen" → Uranüs **veya** Neptün. Çözüm de bunu kabul ediyor; soru ise kesin eşleştirme istiyor. | Tabloya N için ayırt edici ipucu ekle (ör. "Güneş'e yakınlıkta M'den hemen sonra gelir"). |
| `pool-1795729240625-50` | **Belirsiz ifade → yanlış çıkış.** 1. ifade "Dünya ve Mars asteroit kuşağının dışında yer alır" kelimesi kelimesine doğru (kuşağın içinde değiller). Doğru kabul eden öğrenci farklı çıkışa gider. | İfadeyi "Dünya ve Mars dış gezegenler grubundadır." yap. |
| `pool-1795725188100-6`, `pool-1795729240625-48`, `pool-1795729240625-25` | **Tarihsel doğruluk.** Biruni'nin "Dünya'nın Güneş etrafında dolandığını vurguladığı" iddiası tartışmalı; Biruni iki modeli de tartışmış, Güneş merkezli modeli kesin olarak savunmamıştır. | Bir Fen öğretmeni/kaynakla doğrulat. Gerekirse Biruni ifadesini yumuşat veya kaldır. |
| `pool-1795725188100-8` | SVG'de yazım hatası: "pilastik" | "plastik" |
| `pool-1795729240625-15` | "Doğal uydusu bulunmalı" yaşam kriteri olarak onaylanıyor → kavram yanılgısı oluşturabilir. | Kriteri "Atmosferi bulunmalı" gibi bilimsel bir kriterle değiştir. |

**Genel not:** Birçok soruda/çözümde "asteroit kuşağının **içinde/dışında**" ifadesi "iç/dış gezegen" anlamında kullanılıyor; Türkçede "kuşağın içinde" = "kuşağın tam ortasında" diye de okunabilir. Üretim promptuna kural olarak ekle: *"iç gezegenler / dış gezegenler" de; "kuşağın içinde/dışında" deme.*

**Çeşitlilik:** 60 sorunun yaklaşık 15'i asteroit kuşağının yerini, 15'i tutulma dizilimini ölçüyor. Bir sınava rastgele seçilirse tekrar hissi verir. Üretim promptuna "aynı bilgiyi en fazla N soruda ölç" kuralı eklenebilir.

---

## MATEMATİK — Düzeltilmesi gerekenler

### Kopyalar (birini sil)
| Tutulacak | Silinecek | Konu |
|---|---|---|
| `pool-1795732511349-4` | `pool-1795734432565-4` | Kitap bağışı kargo (1 475 kitap) |
| `pool-1795732511349-5` | `pool-1795734432565-5` | Geri dönüşüm katılım oranları |
| `pool-1795732511349-9` | `pool-1795734432565-9` | Güneş enerjili araç testi |
| `pool-1795732511349-10` | `pool-1795734432565-10` | Kırtasiye indirimi |

### İçerik
| ID | Sorun | Öneri |
|---|---|---|
| `pool-1795734432565-36` | Kurgusal veriler **"TÜİK raporuna göre"** diye gerçek bir kuruma atfedilmiş. | "Bir araştırmaya göre" yap. |
| `pool-1795734432565-19` | "Onluk sayı sistemine sıfırı ekleyerek ... Harizmi" — Harizmi sıfırı icat etmedi; Hint rakamlarını (sıfır dahil) tanıttı/yaygınlaştırdı. | "Hint-Arap rakamlarını ve sıfırı tanıtan Harizmi" yap. |
| `pool-1795734432565-34` | "Aynı **ağırlıktaki** ... sütün **litre** fiyatları" — birim karışıklığı. | "Aynı kalitedeki" yap. |

### Müfredat sınırı — matematik öğretmeni kontrol etmeli
- **10 basamaklı sayılar (milyarlar bölüğü):** `pool-1795734432565-39` (çözüm için gerekli), `pool-1795734432565-12` (tabloda). 5. sınıf sınırı 9 basamak ise düzeltilmeli.
- **Açı ilişkileri:** Yaklaşık 30 geometri sorusu *ters açılar, komşu tümler/bütünler açılar, üçgenin iç açıları toplamı, ikizkenar üçgenin taban açıları* kullanıyor. Bu kavramların TYMM 5. sınıf kazanımlarında (MAT.5.3.x) yer alıp almadığı doğrulanmalı. Yer almıyorsa bu soruların büyük kısmı müfredat dışı olur.

### Doğrulananlar
Sayılar, dört işlem, bölme kalanı, yuvarlama, zaman, kesir–ondalık–yüzde dönüşümleri ve geometri hesaplarının tamamı tutarlı (ör. `pool-1795721691555-19`'da verilen açı ve yarıçaplar sinüs teoremiyle bile birbirini tutuyor).

---

## Mobil SVG (mekanik kurallar)
- **Fen:** 60 sorunun **tamamında** yazı boyutu 18'in altında (çoğu 10–14).
- **Matematik:** 50 soruda font < 18, 44 soruda oran < 2,1 (dikey/kareye yakın çizim).
- Türkçe, İngilizce ve Din'de ihlal yok → bu üç ders yeni prompt sürümüyle üretilmiş görünüyor. Fen ve Matematik SVG'leri yeni kurallarla **yeniden üretilmeli**.

## Sınıf alanı
283 sorunun `grade` alanı boş. Kazanım kodundaki ilk sayı sınıfı veriyor; her satırda tek ve tutarlı sonuç çıkıyor:
Matematik → 5, Sosyal → 5, Türkçe → 5, Fen → **6**.
Güncelleme: `supabase/sql/2026-11-28_grade_doldur.sql`

## Havuz genelinde kopyalar
Bütün havuzda 14 kopya grubu (16 fazla soru) vardı: Türkçe 7, Sosyal 3, Matematik 4, İngilizce 1, Din 1.
**28.11.2026'da silindi.** Her gruptan en çok öğretmen oyu alan (eşitse ilk yüklenen) soru tutuldu. Silinenlerin hiçbirinde inceleme kaydı veya sınav bağlantısı yoktu. Havuz: 403 → 387 soru.
