'use client';

/**
 * YouTube embed'ini kapsayıcı paneli TAM dolduran iframe.
 *
 * WKWebView (Tauri) iframe'in 16:9 intrinsic oranını koruyup `height:100%`'i
 * yok sayıyordu (genişlik doluyor, yükseklik 16:9'da kalıp altta boşluk
 * bırakıyordu). Çözüm: wrapper'ı flex column yapıp iframe'e `flex:1` vermek —
 * flex stretch intrinsic aspect'i EZER ve iframe'i her iki yönde paneli
 * dolduracak şekilde gerer. YouTube videoyu kendi içinde 16:9 tutar, kalanı
 * KENDİ SİYAH arka planıyla doldurur → panel #000 ile birleşir, boşluk görünmez.
 */

export function CoverIframe({
  src,
  iframeKey,
  allow = 'autoplay; encrypted-media; picture-in-picture',
  borderRadius = 0,
}: {
  src: string;
  iframeKey?: string;
  allow?: string;
  borderRadius?: number;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: '#000',
        borderRadius,
      }}
    >
      <iframe
        key={iframeKey || src}
        src={src}
        referrerPolicy="strict-origin-when-cross-origin"
        style={{
          flex: '1 1 auto',
          width: '100%',
          height: '100%',
          minHeight: 0,
          border: 'none',
          display: 'block',
          background: '#000',
        }}
        allow={allow}
        allowFullScreen
      />
    </div>
  );
}
