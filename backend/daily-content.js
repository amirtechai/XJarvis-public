/**
 * Günlük dini & motivasyon içeriği — küratörlü, offline, deterministik.
 *
 * Fiyat/haber gibi şeyler "güncel" olmalı (canlı API), ama ayet/hadis/söz
 * sabit metinlerdir; bunları LLM'e uydurtmak yerine doğrulanmış bir yerel
 * setten günün gününe (day-of-year) döndürüyoruz. Kaynak her zaman belirtilir.
 *
 *  - getAyah()       → Kur'an ayeti + Diyanet meali + kısa tefsir notu
 *  - getHadith()     → sahih hadis + kaynak (Buhari / Riyâzü's-Sâlihîn)
 *  - getMotivation() → motivasyon / başarı hikâyesi (ağırlıklı Türk)
 *  - getHijriSignificance(monthNumber, day, holidays) → o günün İslami değeri
 */

function dayOfYear(d = new Date()) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 86_400_000);
}

function pick(list, d = new Date()) {
  return list[dayOfYear(d) % list.length];
}

// --- Ayetler: { ref, ar?, meal (Diyanet İşleri), tefsir (kısa not) } ---------
const AYAHS = [
  { ref: 'Bakara, 286', meal: 'Allah, kimseye gücünün üstünde bir şey yüklemez. Herkesin kazandığı iyilik kendi yararına, işlediği kötülük kendi zararınadır.', tefsir: 'Sorumluluk, kişinin takatiyle sınırlıdır; bu, kulun üzerinden ağır bir yükü kaldıran ilahî bir merhamettir.' },
  { ref: 'İnşirah, 5-6', meal: 'Şüphesiz güçlükle beraber bir kolaylık vardır. Gerçekten, güçlükle beraber bir kolaylık vardır.', tefsir: 'Zorluk ile kolaylık iç içedir; sıkıntı kalıcı değildir, sabredene ferah vaat edilmiştir.' },
  { ref: 'Talak, 2-3', meal: 'Kim Allah\'a karşı gelmekten sakınırsa, Allah ona bir çıkış yolu açar ve onu beklemediği yerden rızıklandırır.', tefsir: 'Takva, çıkmaz görünen durumlarda umulmadık kapıların açılmasının anahtarıdır.' },
  { ref: 'Ra\'d, 28', meal: 'Onlar, inananlar ve kalpleri Allah\'ı anmakla huzura kavuşanlardır. Bilesiniz ki kalpler ancak Allah\'ı anmakla huzur bulur.', tefsir: 'Gerçek iç huzurun kaynağı zikirdir; kalbin sükûneti dünyevî şeylerle değil, Allah\'ı anmakla gelir.' },
  { ref: 'Zümer, 53', meal: 'De ki: Ey kendi aleyhine aşırı giden kullarım! Allah\'ın rahmetinden ümidinizi kesmeyin. Şüphesiz Allah bütün günahları affeder.', tefsir: 'İlahî rahmet, ne kadar büyük olursa olsun günahtan daha geniştir; ümitsizlik mümine yakışmaz.' },
  { ref: 'Bakara, 153', meal: 'Ey iman edenler! Sabrederek ve namaz kılarak Allah\'tan yardım dileyin. Şüphe yok ki Allah sabredenlerle beraberdir.', tefsir: 'Sabır ve namaz, zorluk anında mümine verilen iki güçlü dayanaktır.' },
  { ref: 'Âl-i İmrân, 159', meal: 'Bir kez de karar verdin mi, artık Allah\'a tevekkül et. Allah kendisine tevekkül edenleri sever.', tefsir: 'Tevekkül; tedbiri aldıktan sonra sonucu Allah\'a bırakmaktır, atalet değil teslimiyettir.' },
  { ref: 'Talak, 7', meal: 'Allah hiç kimseye verdiğinden fazlasını yüklemez. Allah, bir güçlükten sonra bir kolaylık yaratacaktır.', tefsir: 'Darlık geçicidir; Allah her sıkıntının ardından genişlik takdir eder.' },
  { ref: 'Nahl, 97', meal: 'Erkek veya kadın, kim mümin olarak iyi iş işlerse, elbette ona hoş bir hayat yaşatacağız.', tefsir: 'İmanla birleşen salih amel, dünyada da güzel ve huzurlu bir yaşamın teminatıdır.' },
  { ref: 'Furkan, 74', meal: 'Rabbimiz! Bize gözümüzü aydınlatacak eşler ve nesiller bağışla ve bizi takva sahiplerine önder kıl.', tefsir: 'Müminin duası yalnız kendisi için değil, ailesi ve neslinin hayrı içindir.' },
  { ref: 'Bakara, 216', meal: 'Olur ki hoşunuza gitmeyen bir şey sizin için hayırlıdır. Allah bilir, siz bilmezsiniz.', tefsir: 'İnsan, hakkındaki hayrı her zaman göremez; ilahî takdire teslimiyet huzur getirir.' },
  { ref: 'Yûsuf, 87', meal: 'Allah\'ın rahmetinden ümit kesmeyin. Çünkü kâfirler topluluğundan başkası Allah\'ın rahmetinden ümidini kesmez.', tefsir: 'Ümitsizlik küfre yakın bir hâldir; mümin her şartta rahmete güvenir.' },
  { ref: 'Mü\'min, 60', meal: 'Rabbiniz şöyle buyurdu: Bana dua edin, duanızı kabul edeyim.', tefsir: 'Dua, kulun Rabbiyle doğrudan bağıdır; istemek ibadetin özüdür.' },
  { ref: 'Hadid, 4', meal: 'Nerede olsanız O sizinle beraberdir. Allah yaptıklarınızı görmektedir.', tefsir: 'Allah\'ın her an huzurunda olma bilinci (ihsan), kulu hem korur hem yüceltir.' },
  { ref: 'Bakara, 152', meal: 'Öyleyse yalnız beni anın ki ben de sizi anayım. Bana şükredin, sakın nankörlük etmeyin.', tefsir: 'Zikir karşılıklıdır; kul Rabbini andıkça O da kulunu anar.' },
  { ref: 'İbrahim, 7', meal: 'Andolsun, eğer şükrederseniz elbette size nimetimi artırırım.', tefsir: 'Şükür, nimetin hem koruyucusu hem çoğaltıcısıdır.' },
  { ref: 'Kehf, 23-24', meal: 'Hiçbir şey için "Bunu yarın yapacağım" deme. Ancak "Allah dilerse (inşallah)" de.', tefsir: 'Gelecek Allah\'ın elindedir; her niyeti O\'nun dilemesine bağlamak edebin gereğidir.' },
  { ref: 'Lokman, 18', meal: 'Küçümseyerek insanlardan yüz çevirme ve yeryüzünde böbürlenerek yürüme. Allah kendini beğenmiş kibirlileri sevmez.', tefsir: 'Tevazu müminin ahlakı, kibir ise reddedilen bir hastalıktır.' },
  { ref: 'Hucurât, 13', meal: 'Allah katında en değerliniz, O\'na karşı gelmekten en çok sakınanınızdır.', tefsir: 'Üstünlük soy ya da makamda değil, takvadadır.' },
  { ref: 'Âl-i İmrân, 139', meal: 'Gevşemeyin, üzülmeyin; eğer gerçekten inanıyorsanız en üstün olan sizsiniz.', tefsir: 'İman, müminin moral ve metanetinin kaynağıdır; yılgınlık imana yakışmaz.' },
  { ref: 'Tevbe, 40', meal: 'Üzülme, çünkü Allah bizimle beraberdir.', tefsir: 'Hz. Peygamber\'in mağarada söylediği bu söz, her darda kalan mümine bir tesellidir.' },
  { ref: 'Bakara, 45', meal: 'Sabır ve namaz ile Allah\'tan yardım isteyin. Şüphesiz bu, huşû duyanlardan başkasına ağır gelir.', tefsir: 'İbadetin ağırlığı, kalpteki huşû ile hafifler.' },
  { ref: 'Duhâ, 4-5', meal: 'Muhakkak ki ahiret senin için dünyadan daha hayırlıdır. Rabbin sana verecek ve sen razı olacaksın.', tefsir: 'Bugünün sıkıntısı yarının hayrına gebedir; ilahî vaat tesellinin kaynağıdır.' },
  { ref: 'Ankebût, 69', meal: 'Bizim uğrumuzda gayret gösterenleri elbette yollarımıza eriştiririz. Allah iyilik edenlerle beraberdir.', tefsir: 'Samimi gayret karşılıksız kalmaz; çaba gösterene hidayet kapıları açılır.' },
  { ref: 'Bakara, 255 (Âyetü\'l-Kürsî)', meal: 'Allah, kendisinden başka hiçbir ilah olmayandır. O daima diridir, her şeyi ayakta tutandır. O\'nu ne uyuklama ne de uyku tutar.', tefsir: 'Kur\'an\'ın en büyük ayeti; Allah\'ın eşsiz kudret ve kayyumiyetini özetler.' },
];

// --- Hadisler: { text, source } ---------------------------------------------
const HADITHS = [
  { text: 'Ameller niyetlere göredir; herkese ancak niyet ettiği vardır.', source: 'Buhârî, Bedü\'l-vahy 1' },
  { text: 'Müslüman, dilinden ve elinden diğer müslümanların güvende olduğu kimsedir.', source: 'Buhârî, Îmân 4' },
  { text: 'Sizden biriniz kendisi için istediğini kardeşi için de istemedikçe (gerçek) iman etmiş olmaz.', source: 'Buhârî, Îmân 7; Riyâzü\'s-Sâlihîn 183' },
  { text: 'Kolaylaştırın, zorlaştırmayın; müjdeleyin, nefret ettirmeyin.', source: 'Buhârî, İlim 11' },
  { text: 'Güçlü kimse, güreşte rakibini yenen değil, öfke anında kendine hâkim olandır.', source: 'Buhârî, Edeb 76; Riyâzü\'s-Sâlihîn 45' },
  { text: 'Allah\'a ve ahiret gününe iman eden ya hayır söylesin ya sussun.', source: 'Buhârî, Edeb 31; Riyâzü\'s-Sâlihîn 1511' },
  { text: 'Merhamet etmeyene merhamet olunmaz.', source: 'Buhârî, Edeb 18' },
  { text: 'Kişi sevdiği ile beraberdir.', source: 'Buhârî, Edeb 96; Riyâzü\'s-Sâlihîn 366' },
  { text: 'Mümin bir delikten iki defa ısırılmaz.', source: 'Buhârî, Edeb 83' },
  { text: 'Sizin en hayırlınız ahlakı en güzel olanınızdır.', source: 'Buhârî, Edeb 39; Riyâzü\'s-Sâlihîn 626' },
  { text: 'Komşusu açken tok yatan, bizden değildir.', source: 'Riyâzü\'s-Sâlihîn 296 (Hâkim)' },
  { text: 'Kim bir kardeşinin ihtiyacını giderirse, Allah da onun ihtiyacını giderir.', source: 'Buhârî, Mezâlim 3; Riyâzü\'s-Sâlihîn 220' },
  { text: 'Allah katında amellerin en sevimlisi, az da olsa devamlı olanıdır.', source: 'Buhârî, Îmân 32; Riyâzü\'s-Sâlihîn 142' },
  { text: 'Veren el, alan elden üstündür.', source: 'Buhârî, Zekât 18' },
  { text: 'Temizlik imanın yarısıdır.', source: 'Müslim, Tahâret 1; Riyâzü\'s-Sâlihîn 25' },
  { text: 'Hiçbiriniz, kendisi için istediğini kardeşi için de istemedikçe iman etmiş olamaz.', source: 'Riyâzü\'s-Sâlihîn 183 (Buhârî & Müslim)' },
  { text: 'Güzel söz sadakadır.', source: 'Buhârî, Cihâd 72; Riyâzü\'s-Sâlihîn 695' },
  { text: 'Kim bir hayra öncülük ederse, onu yapanın ecri kadar sevap alır.', source: 'Müslim, İmâre 133; Riyâzü\'s-Sâlihîn 173' },
  { text: 'Sabır, ilk darbe anında gösterilen sabırdır.', source: 'Buhârî, Cenâiz 32; Riyâzü\'s-Sâlihîn 38' },
  { text: 'Tebessümün bir sadakadır.', source: 'Tirmizî, Birr 36; Riyâzü\'s-Sâlihîn 122' },
  { text: 'İnsanlara teşekkür etmeyen, Allah\'a da şükretmez.', source: 'Ebû Dâvûd, Edeb 11; Riyâzü\'s-Sâlihîn 1372' },
  { text: 'Din nasihattir.', source: 'Müslim, Îmân 95; Riyâzü\'s-Sâlihîn 180' },
  { text: 'Allah sizin suretlerinize ve mallarınıza değil, kalplerinize ve amellerinize bakar.', source: 'Müslim, Birr 33; Riyâzü\'s-Sâlihîn 7' },
  { text: 'Kim bir ilim öğrenmek için yola çıkarsa, Allah ona cennetin yolunu kolaylaştırır.', source: 'Müslim, Zikir 38; Riyâzü\'s-Sâlihîn 1381' },
  { text: 'İki nimet vardır ki insanların çoğu bunlarda aldanmıştır: Sağlık ve boş vakit.', source: 'Buhârî, Rikâk 1; Riyâzü\'s-Sâlihîn 95' },
];

// --- Motivasyon / başarı hikâyesi -------------------------------------------
const MOTIVATIONS = [
  { text: 'Hayatta en hakiki mürşit ilimdir.', by: 'Mustafa Kemal Atatürk' },
  { text: 'Çalışmak bizim vazifemiz, neticesini takdir etmek Allah\'a aittir.', by: 'Bediüzzaman Said Nursî' },
  { text: 'Sahip olduğun en güçlü silah, denenmiş ve vazgeçmemiş bir zihindir.', by: 'Anonim' },
  { text: 'Aziz Sancar, Mardin\'in bir köyünden çıkıp Nobel Kimya Ödülü\'ne uzandı; azim, coğrafyayı aşar.', by: 'Başarı hikâyesi — Aziz Sancar' },
  { text: 'Başarı, küçük çabaların her gün tekrarlanmasıdır.', by: 'Robert Collier' },
  { text: 'Bir şeyi yeterince çok istiyorsan, tüm evren onu gerçekleştirmen için seninle iş birliği yapar.', by: 'Paulo Coelho' },
  { text: 'Düşmeden yürümeyi öğrenen yoktur; her düşüş bir derstir.', by: 'Anonim' },
  { text: 'Vehbi Koç işe bir bakkal dükkânıyla başladı; büyük işler, küçük ama kararlı adımlarla kurulur.', by: 'Başarı hikâyesi — Vehbi Koç' },
  { text: 'Geleceği tahmin etmenin en iyi yolu, onu inşa etmektir.', by: 'Peter Drucker' },
  { text: 'Zorluklar, seni kıracak değil, seni inşa edecek malzemedir.', by: 'Anonim' },
  { text: 'Cahit Arf, bir teoremiyle adını matematik tarihine yazdırdı; bir fikir, bir ömrü aşar.', by: 'Başarı hikâyesi — Cahit Arf' },
  { text: 'Yapabileceğine inanırsan yarı yolu kat etmişsin demektir.', by: 'Theodore Roosevelt' },
  { text: 'Bugün yapabileceğini yarına bırakma; zaman, en adil ve en acımasız sermayedir.', by: 'Anonim' },
  { text: 'Mimar Sinan, Selimiye\'yi seksenli yaşlarında tamamladı; ustalığın yaşı yoktur.', by: 'Başarı hikâyesi — Mimar Sinan' },
  { text: 'Başarısızlık, daha akıllıca yeniden başlama fırsatından ibarettir.', by: 'Henry Ford' },
  { text: 'Disiplin, hedeflerle başarı arasındaki köprüdür.', by: 'Jim Rohn' },
  { text: 'Sakıp Sabancı işçilikten Türkiye\'nin en büyük sanayicilerinden birine yükseldi; emek, kaderi yazar.', by: 'Başarı hikâyesi — Sakıp Sabancı' },
  { text: 'Yıldızlara uzanmak isteyen, önce ayaklarını yere sağlam basmalı.', by: 'Anonim' },
  { text: 'Küçük fırsatlar çoğu zaman büyük girişimlerin başlangıcıdır.', by: 'Demosthenes' },
  { text: 'Fatih Sultan Mehmet 21 yaşında çağ kapatıp çağ açtı; gençlik, doğru hedefle bir kuvvettir.', by: 'Başarı hikâyesi — Fatih Sultan Mehmet' },
  { text: 'Pes etmek için bin sebep bulabilirsin; devam etmek için bir tane yeter.', by: 'Anonim' },
  { text: 'En karanlık gece bile sona erer ve güneş yeniden doğar.', by: 'Victor Hugo' },
  { text: 'Hedefin yoksa hiçbir rüzgâr işine yaramaz.', by: 'Seneca' },
  { text: 'Bilgi güçtür, ama uygulanan bilgi gerçek güçtür.', by: 'Anonim' },
  { text: 'Asıl mesele düşmemekte değil, her düştüğünde yeniden kalkabilmektedir.', by: 'Konfüçyüs' },
];

// Hicri özel günler — Aladhan month.number (1-12) ve gün ile eşleştirilir.
function getHijriSignificance(monthNumber, day, holidays = []) {
  const m = Number(monthNumber), d = Number(day);
  const special = {
    '1-1': 'Hicri Yılbaşı — Muharrem ayının başı, yeni İslami yılın ilk günü.',
    '1-10': 'Aşure Günü — Muharrem\'in 10\'u; pek çok peygamberin kurtuluşunun anıldığı, oruç tutulan mübarek gün.',
    '3-12': 'Mevlid Kandili — Hz. Peygamber (sav) Efendimiz\'in dünyaya teşrif ettiği gece.',
    '7-1': 'Üç Ayların başlangıcı (Recep ayı) — manevi hazırlık ve ibadet mevsiminin açılışı.',
    '7-27': 'Miraç Kandili — Hz. Peygamber\'in Mîrac mucizesinin ve beş vakit namazın farz kılındığı gece.',
    '8-15': 'Berat Kandili — affın ve bağışlanmanın bol olduğu, dua ve tevbe gecesi.',
    '9-1': 'Ramazan ayının başlangıcı — oruç ve Kur\'an ayı.',
    '9-27': 'Kadir Gecesi — bin aydan hayırlı, Kur\'an\'ın indirilmeye başlandığı en mübarek gece.',
    '10-1': 'Ramazan Bayramı 1. günü — bir aylık orucun ardından bayram sevinci.',
    '10-2': 'Ramazan Bayramı 2. günü.',
    '10-3': 'Ramazan Bayramı 3. günü.',
    '12-9': 'Arefe Günü — Kurban Bayramı\'nın arefesi; Hac\'da vakfe günü, oruç ve duanın faziletli olduğu gün.',
    '12-10': 'Kurban Bayramı 1. günü — kurban ibadeti ve bayram.',
    '12-11': 'Kurban Bayramı 2. günü (Teşrik günleri).',
    '12-12': 'Kurban Bayramı 3. günü (Teşrik günleri).',
    '12-13': 'Kurban Bayramı 4. günü (Teşrik günleri).',
  };
  const key = `${m}-${d}`;
  if (special[key]) return special[key];
  if (Array.isArray(holidays) && holidays.length) return holidays.join(', ');
  // Cuma günü kontrolü çağıran tarafa bırakıldı; genel günler için kısa not.
  if (m === 9) return 'Ramazan ayı — oruç, sabır ve Kur\'an ayının bereketli günlerindesiniz.';
  if (m === 7 || m === 8) return 'Üç Aylar — manevi yoğunluğun arttığı, ibadet ve tevbe mevsimi.';
  return '';
}

const HIJRI_MONTHS_TR = ['', 'Muharrem', 'Safer', 'Rebiülevvel', 'Rebiülahir', 'Cemaziyelevvel',
  'Cemaziyelahir', 'Recep', 'Şaban', 'Ramazan', 'Şevval', 'Zilkade', 'Zilhicce'];

module.exports = {
  HIJRI_MONTHS_TR,
  hijriMonthTr: (n) => HIJRI_MONTHS_TR[Number(n)] || '',
  getAyah: (d) => pick(AYAHS, d),
  getHadith: (d) => pick(HADITHS, d),
  getMotivation: (d) => pick(MOTIVATIONS, d),
  getHijriSignificance,
};
