/**
 * Günün İç Görüsü — XJarvis'in kendi tavsiyesi: Carl Jung psikolojisi × İmam Gazâlî
 * tasavvuf/ahlak merkezli sentez + uygulanabilir öneri. day-of-year rotasyon.
 */
function dayOfYear(d=new Date()){const s=new Date(d.getFullYear(),0,0);return Math.floor((d-s)/86400000);}
const A = [
  { tema:'Gölge × Nefs Muhasebesi', icgoru:'Jung\'a göre reddettiğin "gölge" yanların seni gizliden yönetir; Gazâlî bunu nefsin hileleri olarak görür. İkisi de der ki: kendini tanımayan, kendine esir olur.', tavsiye:'Bugün seni en çok öfkelendiren şeyi yaz; o öfke, kendine dair görmek istemediğin neyi gösteriyor?' },
  { tema:'Bireyleşme × Kalbin Arınması', icgoru:'Jung\'un "bireyleşme"si, parçalanmış benliği bütünlemektir; Gazâlî\'de bu, kalbi mâsivâdan arındırıp asıl cevhere dönmektir. Olgunluk, dışarıyı değil içeriyi düzenlemekle başlar.', tavsiye:'Bugün 10 dakika sessiz kal; dış sesleri kıs, içindeki asıl sesi dinle. Ne istiyorsun, gerçekten?' },
  { tema:'Persona × İhlas', icgoru:'Jung\'un "persona"sı topluma gösterdiğin maskedir; Gazâlî riyayı, maskeyle yaşamayı amelin afeti sayar. İkisi de samimiyete çağırır: maske yorar, hakikat dinlendirir.', tavsiye:'Bugün bir işi kimse görmeyecekmiş gibi yap; gösteriş için değil, kendin ve Hakk için.' },
  { tema:'Benlik (Self) × Marifetullah', icgoru:'Jung için "Self", kişiliğin merkezindeki bütünlük; Gazâlî için "nefsini bilen Rabbini bilir." Kendini tanıma yolculuğu, aslında daha büyük bir hakikate açılan kapıdır.', tavsiye:'Bugün bir kararını "neden gerçekten bunu istiyorum?" diye üç kez sorgula; yüzeyin altındaki niyeti bul.' },
  { tema:'Anima/Animus × Kalbin Dengesi', icgoru:'Jung, içimizdeki karşıt enerjilerin (akıl-duygu) dengesini olgunluk sayar; Gazâlî kalbi havf ile recâ (korku-ümit) arasında dengede tutar. Aşırılık değil, denge bilgeliktir.', tavsiye:'Bugün bir konuda hem aklını hem sezgini dinle; sadece birine güvenme, ikisini buluştur.' },
  { tema:'Gölgeyle Yüzleşme × Tevbe', icgoru:'Jung der ki: bastırdığın geri döner. Gazâlî der ki: tevbe, hatayı görüp ondan dönmektir. İkisi de kaçmayı değil, yüzleşip dönüşmeyi öğütler.', tavsiye:'Bugün kaçtığın bir gerçeği kabul et; onu yargılamadan gör, sonra küçük bir düzeltme adımı at.' },
  { tema:'Anlam Arayışı × Gaye', icgoru:'Jung, nevrozun çoğunu "anlamsızlık" olarak teşhis eder; Gazâlî, insanı gayesiz bırakmanın en büyük kayıp olduğunu söyler. Anlam, dışarıda bulunmaz; üretilir ve niyetle yüklenir.', tavsiye:'Bugün yaptığın sıradan bir işe bir "neden/gaye" yükle; o iş, anlamıyla birlikte ağırlık kazanır.' },
  { tema:'Sembol/Rüya × Tefekkür', icgoru:'Jung rüyaları bilinçdışının mesajı sayar; Gazâlî tefekkürü kalbin gözünü açan ibadet görür. İkisi de "yüzeyin altına bak" der.', tavsiye:'Bugün sık tekrarlayan bir düşünceni/rüyanı not et; sana neyi anlatmaya çalışıyor?' },
  { tema:'Kolektif Bilinçdışı × Fıtrat', icgoru:'Jung, insanlığın ortak mirasını "kolektif bilinçdışı" der; Gazâlî, her insanda hakikate meyilli bir "fıtrat" olduğunu söyler. İçindeki o saf pusulayı kirletme.', tavsiye:'Bugün bir kararı "menfaatim ne?" yerine "fıtratım/vicdanım ne diyor?" ile ver.' },
  { tema:'Bütünleşme × İstikamet', icgoru:'Jung\'un hedefi parçaları birleştirmek; Gazâlî\'nin yolu istikamet, yani dağılmadan tek yöne yürümek. Dağınık enerji güçsüzdür; toplanan enerji yön kazanır.', tavsiye:'Bugün enerjini bölen 3 şeyi yaz; birini bırak, gücünü asıl hedefe topla.' },
  { tema:'Yaşlanan Benlik × Ölümü Anmak', icgoru:'Jung, ömrün ikinci yarısını "anlam ve içe dönüş" zamanı sayar; Gazâlî ölümü anmayı kalbi diriltmek için öğütler. Sonu hatırlamak, bugünü ciddiye almaktır.', tavsiye:'Bugün "bu iş 5 yıl sonra önemli olacak mı?" diye sor; cevaba göre önceliğini düzelt.' },
  { tema:'Karşıtların Birliği × Sabır', icgoru:'Jung, zıtlıkların geriliminden büyüme doğduğunu söyler; Gazâlî, zorlukla kolaylığın iç içe olduğunu hatırlatır. Acı, dönüşümün ham maddesidir.', tavsiye:'Bugün seni zorlayan bir durumu "düşman" değil "öğretmen" olarak gör; sana ne öğretiyor?' },
  { tema:'Projeksiyon × Başkasında Kendini Görmek', icgoru:'Jung, başkalarında en çok rahatsız olduğumuz şeyin kendi gölgemiz olduğunu söyler; Gazâlî, ayıp arayan gözün kendi ayıbını göremediğini hatırlatır.', tavsiye:'Bugün birini eleştirmek istediğinde dur; o özellik bir parça sende de var mı, dürüstçe bak.' },
  { tema:'İçsel Ses × Kalp', icgoru:'Jung, sağlığın "kendi efsaneni yaşamak" olduğunu söyler; Gazâlî, asıl rehberin arınmış kalp olduğunu öğretir. Kalabalığın değil, kalbinin sesini büyüt.', tavsiye:'Bugün bir kararı vermeden önce telefonu bırak, kalbinin ilk net cevabını dinle.' },
  { tema:'Dönüşüm × Mücâhede', icgoru:'Jung, dönüşümün konfor alanının dışında olduğunu söyler; Gazâlî, en büyük cihadın nefisle olduğunu hatırlatır. Büyüme, rahatlığın bittiği yerde başlar.', tavsiye:'Bugün küçük ama zor gelen bir şeyi yap (ertelediğin tek iş); nefsine değil, iradene kulak ver.' },
];
function composeAdvisor(){
  const a = A[dayOfYear()%A.length];
  return ['🧭 *Günün İç Görüsü · Jung × Gazâlî*','',`*${a.tema}*`,'',a.icgoru,'',`💡 *Bugünkü öneri:* ${a.tavsiye}`].join('\n');
}
module.exports = { composeAdvisor };
