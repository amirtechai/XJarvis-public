/**
 * Günün Lideri — dünyaca ünlü iş insanlarından motive edici söz/öz (küratörlü).
 * İş, teknoloji, girişimcilik, yapay zeka, hayat. day-of-year rotasyon.
 */
function dayOfYear(d=new Date()){const s=new Date(d.getFullYear(),0,0);return Math.floor((d-s)/86400000);}
const Q = [
  { soz:'Aç kal, akılsız kal. (Stay hungry, stay foolish.)', kim:'Steve Jobs', tema:'vizyon' },
  { soz:'İnovasyon, liderle takipçiyi ayıran şeydir.', kim:'Steve Jobs', tema:'inovasyon' },
  { soz:'Bir şeyin işe yaramayacağına dair her kanıt, onu yapana kadar geçerlidir.', kim:'Elon Musk', tema:'azim' },
  { soz:'İnsanlığın geleceğini umursuyorsan, sürdürülebilir enerjiye ve çok-gezegenli yaşama yatırım yap.', kim:'Elon Musk', tema:'gelecek' },
  { soz:'Fiyat ödediğin, değer aldığın şeydir.', kim:'Warren Buffett', tema:'yatırım' },
  { soz:'Başkaları açgözlüyken korkak, korkakken açgözlü ol.', kim:'Warren Buffett', tema:'finans' },
  { soz:'İtibarını oluşturmak 20 yıl, yıkmak 5 dakika alır. Bunu düşünürsen işleri farklı yaparsın.', kim:'Warren Buffett', tema:'itibar' },
  { soz:'Müşterini davet edilmemiş bir partinin konuğu say; işin onları memnun etmek.', kim:'Jeff Bezos', tema:'müşteri' },
  { soz:'Sürekli "Gün 1" zihniyetinde kal; "Gün 2" durağanlıktır, sonu çöküştür.', kim:'Jeff Bezos', tema:'girişim' },
  { soz:'En mutsuz müşterilerin, en büyük öğrenme kaynağındır.', kim:'Bill Gates', tema:'öğrenme' },
  { soz:'Başarıyı kutlamak güzel, ama başarısızlığın derslerine kulak vermek daha önemli.', kim:'Bill Gates', tema:'başarısızlık' },
  { soz:'Yapay zeka, insanlığın üzerinde çalıştığı en derin şeylerden biri; ateşten ya da elektrikten daha derin.', kim:'Sundar Pichai', tema:'yapay zeka' },
  { soz:'Yapay zekânın faydası, onu herkes için erişilebilir kılmakta yatar.', kim:'Sam Altman', tema:'yapay zeka' },
  { soz:'Ne kadar çok çalışırsan, şansın o kadar artar.', kim:'Sam Altman', tema:'çalışkanlık' },
  { soz:'Geleceği hayal edemezsen, onu inşa edemezsin. Hesaplama gücü yeni petroldür.', kim:'Jensen Huang', tema:'teknoloji' },
  { soz:'Bugün yapabileceğin en iyi şey, küçük de olsa bir adım atmaktır.', kim:'Richard Branson', tema:'eylem' },
  { soz:'Fırsatlar otobüs gibidir; biri kaçsa da bir sonraki gelir, hazır ol.', kim:'Richard Branson', tema:'fırsat' },
  { soz:'Ya bir yol bulurum ya da bir yol açarım.', kim:'Henry Ford', tema:'irade' },
  { soz:'Yapabileceğini düşünsen de düşünmesen de haklısın.', kim:'Henry Ford', tema:'inanç' },
  { soz:'Memleketim ne kazandırırsa, ben de onu yaparım; ülke kazanırsa biz de kazanırız.', kim:'Vehbi Koç', tema:'iş ahlakı' },
  { soz:'Para kazanmak marifet değil; kazandığını koruyup büyütmek marifettir.', kim:'Sakıp Sabancı', tema:'iş' },
  { soz:'Zenginlik, çok şeye sahip olmak değil; az şeye ihtiyaç duymaktır.', kim:'Naval Ravikant', tema:'hayat' },
  { soz:'Spesifik bilgi, peşinden koşamayacağın; ancak merakını takip ederek bulacağın şeydir.', kim:'Naval Ravikant', tema:'kariyer' },
  { soz:'Rekabet etme, tekel ol; gerçekten değerli olan, kimsenin yapmadığını yapmaktır.', kim:'Peter Thiel', tema:'strateji' },
];
function composeMentor(){
  const q = Q[dayOfYear()%Q.length];
  return ['💼 *Günün Lideri*','',`“${q.soz}”`,'',`— *${q.kim}* · _${q.tema}_`].join('\n');
}
module.exports = { composeMentor };
