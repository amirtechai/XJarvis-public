/**
 * Günlük tasavvuf özeti — küratörlü, doğrulanmış kısa konu özetleri + konu-hedefli link.
 * İmam Gazâlî (İhyâ, Kimyâ-yı Saâdet, Minhâcü'l-Âbidîn), Abdülkadir Geylânî (Sohbetler),
 * Muhyiddîn İbn Arabî. Her gün her kaynaktan 1 konu (day-of-year rotasyon).
 */
function dayOfYear(d = new Date()) {
  const s = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - s) / 86400000);
}
const pick = (arr) => arr[dayOfYear() % arr.length];
const SRC = {
  ihya: 'https://archive.org/details/ihyauulumiddin',
  kimya: 'https://archive.org/details/KimyaySaadetmamGazaliSayfa752',
  minhac: 'https://archive.org/details/minhacul-abidin-okumalari-nureddin-yildiz',
  geylani: 'https://archive.org/details/001seyyidabdulkadirgeylanihazretlerininnasihatlerikaderekarsigelmemek',
  ibnarabi: 'https://archive.org/details/futuhat-i-mekkiye-18-muhyiddin-ibn-arabi',
};

const IHYA = [
  { konu: 'İlim', ozet: 'İlim ibadetin temelidir; faydalı ilim kalbi Allah\'a yaklaştıran, amele dönüşen ilimdir.', q: 'Gazali İhya ilim bahsi faydalı ilim' },
  { konu: 'İhlas', ozet: 'Amelin kıymeti niyettedir; ihlas, ameli yalnız Allah için yapıp halkın görmesini umursamamaktır.', q: 'Gazali İhya ihlas niyet bahsi' },
  { konu: 'Sabır', ozet: 'Sabır, nefsin şikâyetten alıkonması; imanın yarısı sabır, yarısı şükürdür.', q: 'Gazali İhya sabır ve şükür' },
  { konu: 'Tevekkül', ozet: 'Tevekkül, tedbiri aldıktan sonra kalbi yalnız Allah\'a bağlamak; sebeplere değil Müsebbib\'e güvenmektir.', q: 'Gazali İhya tevekkül bahsi' },
  { konu: 'Tevbe', ozet: 'Tevbe; günahı bırakmak, pişman olmak ve bir daha dönmemeye azmetmektir. Kapısı ölüme dek açıktır.', q: 'Gazali İhya tevbe bahsi' },
  { konu: 'Havf ve Recâ', ozet: 'Mümin korku ile ümit arasında olmalı; havf günahtan alıkoyar, recâ ibadete sevk eder.', q: 'Gazali İhya havf reca korku ümit' },
  { konu: 'Dilin Afetleri', ozet: 'Gıybet, yalan ve boş söz kalbi karartır; dilini tutan selâmete erer.', q: 'Gazali İhya dilin afetleri gıybet' },
  { konu: 'Zikir', ozet: 'Kalbin huzuru Allah\'ı anmakla gelir; zikir, gafleti gideren cilâdır.', q: 'Gazali İhya zikir ve dua' },
  { konu: 'Dünya Sevgisi', ozet: 'Dünya sevgisi her hatanın başıdır; dünya ahiretin tarlası kadarıyla değerlidir.', q: 'Gazali İhya dünyanın zemmi dünya sevgisi' },
  { konu: 'Ölümü Anmak', ozet: 'Ölümü çok anmak kalbi diriltir, dünyaya bağlılığı azaltır, ahirete hazırlar.', q: 'Gazali İhya ölümü hatırlamak' },
];

const KIMYA = [
  { konu: 'Kendini Bilmek', ozet: 'Saadetin anahtarı nefsini tanımaktır; nefsini bilen Rabbini bilir.', q: 'Gazali Kimya-yı Saadet kendini bilmek nefsini bilen Rabbini bilir' },
  { konu: 'Allah\'ı Tanımak', ozet: 'Gerçek mutluluk Allah\'ı marifet (tanımak) ile elde edilir; kalbin gıdası budur.', q: 'Gazali Kimya-yı Saadet Allahı tanımak marifetullah' },
  { konu: 'Dünyayı Tanımak', ozet: 'Dünya bir konaklama yeridir; yolcu, azığını alıp geçer, ona gönül bağlamaz.', q: 'Gazali Kimya-yı Saadet dünyayı tanımak' },
  { konu: 'Ahireti Tanımak', ozet: 'Asıl yurt ahirettir; akıllı kişi kalıcı olanı geçici olana tercih eder.', q: 'Gazali Kimya-yı Saadet ahireti tanımak' },
  { konu: 'Kalbin Hakikati', ozet: 'İnsanın hakikati kalbidir; beden onun bineği, azalar hizmetçisidir. Saadet kalbin arınmasıyladır.', q: 'Gazali Kimya-yı Saadet kalbin hakikati' },
  { konu: 'Saadetin Kimyası', ozet: 'Mutluluğun dört unsuru: nefsi, Allah\'ı, dünyayı ve ahireti doğru tanımak.', q: 'Gazali Kimya-yı Saadet mutluluğun dört esası' },
  { konu: 'Nefis Terbiyesi', ozet: 'Nefis terbiye edilmedikçe azar; riyâzet ve mücâhede ile yumuşar, itaate gelir.', q: 'Gazali Kimya-yı Saadet nefis terbiyesi riyazet' },
];

const MINHAC = [
  { konu: 'İlim Akabesi', ozet: 'Kulluğun ilk engeli cehalettir; ibadet ancak doğru ilimle sahih olur.', q: 'Gazali Minhacül Abidin ilim akabesi' },
  { konu: 'Tevbe Akabesi', ozet: 'Yola girişin şartı tevbedir; geçmiş günahlardan arınmadan ilerlenmez.', q: 'Gazali Minhacül Abidin tevbe akabesi' },
  { konu: 'Engeller (Avâik)', ozet: 'Kulu Allah\'tan alıkoyan dört şey: dünya, halk, şeytan ve nefis. Her birinin çaresi vardır.', q: 'Gazali Minhacül Abidin avaik dünya halk şeytan nefis' },
  { konu: 'Musibetler (Avârız)', ozet: 'Rızık kaygısı ve musibetler yolda sınavdır; tevekkül ve sabır ile aşılır.', q: 'Gazali Minhacül Abidin avarız musibetler' },
  { konu: 'Sevk Ediciler (Bevâis)', ozet: 'İbadete sevk eden iki kanat: havf (korku) ve recâ (ümit). İkisi dengede olmalı.', q: 'Gazali Minhacül Abidin bevais havf reca' },
  { konu: 'İçi Bozanlar (Kavâdih)', ozet: 'Ameli bozan riyâ ve ucub (kendini beğenme); ihlas ile temizlenir.', q: 'Gazali Minhacül Abidin kavadih riya ucub' },
  { konu: 'Hamd ve Şükür', ozet: 'Yolun sonu şükürdür; her nimeti O\'ndan bilip hamd etmek kulluğun zirvesidir.', q: 'Gazali Minhacül Abidin hamd ve şükür akabesi' },
];

const GEYLANI = [
  { konu: 'Tevekkül', ozet: 'Kalbini sebeplerden çek, Müsebbib\'e bağla; rızkın endişesi seni Rabbinden alıkoymasın.', q: 'Abdülkadir Geylani Fethur Rabbani tevekkül' },
  { konu: 'Nefisle Mücadele', ozet: 'En büyük cihad nefsinle olandır; o seni dünyaya, sen onu Hakka çağır.', q: 'Abdülkadir Geylani sohbetler nefisle mücadele' },
  { konu: 'Belâya Sabır', ozet: 'Belâ müminin kalbini arındırır; sabret, çünkü sabrın sonunda ferahlık vardır.', q: 'Abdülkadir Geylani belaya sabır' },
  { konu: 'Rıza', ozet: 'Kaderin tecellîsine razı ol; Hakk\'ın taksimine itiraz, edebe aykırıdır.', q: 'Abdülkadir Geylani rıza kaza kader' },
  { konu: 'Halktan Hakka', ozet: 'İhtiyacını halka değil Hakka arz et; kapıların kapısı O\'nun kapısıdır.', q: 'Abdülkadir Geylani halka değil Hakka yönelmek' },
  { konu: 'Kalp Temizliği', ozet: 'Kalbini mâsivâdan (Allah\'tan gayrısından) temizle ki marifet nuru orada parlasın.', q: 'Abdülkadir Geylani kalp temizliği masiva' },
  { konu: 'Dünyadan El Çekmek', ozet: 'Dünya elinde olsun, kalbinde olmasın; gemi suda yüzer, içine su girerse batar.', q: 'Abdülkadir Geylani dünyadan el çekmek zühd' },
  { konu: 'İhlas', ozet: 'Amelini halka gösterme; gizli amelin, açıktan yapılandan üstündür.', q: 'Abdülkadir Geylani ihlas gizli amel' },
];

const IBNARABI = [
  { konu: 'İnsan-ı Kâmil', ozet: 'Kâmil insan, ilahî isimlerin tam tecellî ettiği aynadır; yaratılışın gayesi odur.', q: 'İbn Arabi insan-ı kamil' },
  { konu: 'Marifetullah', ozet: 'Rabbini tanımak, önce kendini tanımakla başlar; "nefsini bilen Rabbini bilir."', q: 'İbn Arabi marifetullah nefsini bilen' },
  { konu: 'İlâhî Sevgi', ozet: '"Allah güzeldir, güzeli sever." Varlık, ilahî sevginin tecellîsiyle zuhûra geldi.', q: 'İbn Arabi ilahi sevgi muhabbet' },
  { konu: 'Kalbin Genişliği', ozet: 'Ârifin kalbi her surete açıktır; merhamet ve sevgiyle her hakikati kuşatır.', q: 'İbn Arabi kalbin genişliği her surete giren kalp' },
  { konu: 'Edep', ozet: 'Tasavvuf baştan sona edeptir; her makamın bir edebi vardır, edebi terk eden yoldan düşer.', q: 'İbn Arabi edep tasavvuf' },
  { konu: 'İlâhî İsimler', ozet: 'Âlem, Allah\'ın güzel isimlerinin (esmâ) gölgeleridir; her varlık bir ismin tecellîsidir.', q: 'İbn Arabi ilahi isimler esma tecelli' },
  { konu: 'Hayret', ozet: 'Marifet arttıkça hayret artar; "Yâ Rabbi, sendeki hayretimi artır."', q: 'İbn Arabi hayret marifet' },
];

function composeTasavvuf() {
  const i = pick(IHYA), k = pick(KIMYA), m = pick(MINHAC), g = pick(GEYLANI), a = pick(IBNARABI);
  return [
    '🕯️ *Günün Tasavvuf Özeti*', '',
    '📖 *İmam Gazâlî*', '',
    `• *İhyâ — ${i.konu}:* ${i.ozet} [📖 eseri oku →](${SRC.ihya})`,
    `• *Kimyâ-yı Saâdet — ${k.konu}:* ${k.ozet} [📖 eseri oku →](${SRC.kimya})`,
    `• *Minhâcü'l-Âbidîn — ${m.konu}:* ${m.ozet} [📖 eseri oku →](${SRC.minhac})`,
    '',
    '🌿 *Abdülkadir Geylânî — Sohbetler*', '',
    `• *${g.konu}:* ${g.ozet} [📖 eseri oku →](${SRC.geylani})`,
    '',
    '🔆 *Muhyiddîn İbn Arabî*', '',
    `• *${a.konu}:* ${a.ozet} [📖 eseri oku →](${SRC.ibnarabi})`,
    '',
    '_Küratörlü kısa özet · linkler eserlerin archive.org tam metnine gider._',
  ].join('\n');
}

module.exports = { composeTasavvuf };
