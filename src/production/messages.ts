import type { StageId } from '../api/production';
export const productionRo = {
  title: 'Producție', submit: 'Trimite în producție', question: 'Trimiteți comanda în producție?',
  confirm: 'Confirmă trimiterea', cancel: 'Înapoi', loading: 'Se verifică producția…', sending: 'Se trimite…',
  notSubmitted: 'Nu a fost trimisă în producție', submitted: 'Trimisă în producție', completed: 'Producție finalizată',
  draftHint: 'Finalizați comanda înainte de a o trimite în producție.', cancelledHint: 'O comandă anulată nu poate fi trimisă în producție.',
  hint: 'Acțiune separată de finalizarea comercială. Nu modifică prețurile sau contul curent.',
  warning: 'Datele comerciale înghețate vor crea o singură comandă de producție. După trimitere, anularea comercială nu mai este permisă.',
  operator: 'Etapele sunt gestionate exclusiv de Staff.', refresh: 'Actualizează producția', sentAt: 'Trimisă la',
  changedAt: 'Etapă actualizată la', finishedAt: 'Finalizată la', reference: 'Referință operațională', cancelBlocked: 'Anularea este blocată: comanda a fost trimisă în producție.',
  progress: (current: number, total: number) => `Etapa ${current} din ${total}`,
};
export const productionTr: typeof productionRo = {
  title: 'Üretim', submit: 'Üretime gönder', question: 'Sipariş üretime gönderilsin mi?', confirm: 'Gönderimi onayla', cancel: 'Geri',
  loading: 'Üretim kontrol ediliyor…', sending: 'Gönderiliyor…', notSubmitted: 'Üretime gönderilmedi', submitted: 'Üretime gönderildi', completed: 'Üretim tamamlandı',
  draftHint: 'Üretime göndermeden önce siparişi kesinleştirin.', cancelledHint: 'İptal edilmiş sipariş üretime gönderilemez.',
  hint: 'Ticari kesinleştirmeden ayrı bir işlemdir. Fiyatları veya cari hesabı değiştirmez.',
  warning: 'Dondurulmuş ticari bilgiler tek bir üretim siparişi oluşturur. Gönderimden sonra ticari iptal yapılamaz.',
  operator: 'Üretim aşamalarını yalnızca Staff yönetir.', refresh: 'Üretimi yenile', sentAt: 'Gönderim zamanı', changedAt: 'Aşama güncelleme zamanı',
  finishedAt: 'Tamamlanma zamanı', reference: 'Operasyon referansı', cancelBlocked: 'İptal engellendi: sipariş üretime gönderildi.',
  progress: (current, total) => `Aşama ${current} / ${total}`,
};
/** API-owned stage IDs; one Turkish presentation dictionary, never a copied workflow state. */
export const stagesTr: Record<StageId, string> = {
  waiting: 'Bekliyor', 'material-preparation': 'Malzeme Hazırlığı', 'workshop-receiving': 'Atölye Kabul', labeling: 'Etiketleme',
  'material-straightening': 'Kumaş Düzeltme', 'bottom-hem': 'Alt Kenar Dikişi', 'side-hem': 'Yan Kenar Dikişi', ironing: 'Ütüleme',
  height: 'Boy Ayarı', 'header-tape': 'Perde Bandı', 'sewing-finishing': 'Dikiş Tamamlama', 'quality-control': 'Kalite Kontrol', packing: 'Paketleme', delivery: 'Teslimat',
};
