import { useEffect, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, Box, Boxes, Check, ChevronRight, Download, Menu, PackageCheck, Printer, ScanBarcode, Smartphone, X } from 'lucide-react';
import './marketing-landing.css';

const stages = [
  { name: 'Приёмка', title: 'Каждая единица — в учёте.', text: 'Товар, ШК и КИЗ связываются с коробом. Состав приёмки остаётся в истории.', detail: 'ШК → КИЗ → короб', icon: ScanBarcode },
  { name: 'Хранение', title: 'У товара есть точный адрес.', text: 'Короб, паллетсорт, ячейка и филиал. Остатки и перемещения доступны в одном контуре.', detail: 'Короб → паллетсорт → филиал', icon: Boxes },
  { name: 'Сборка', title: 'Сканирование вместо догадок.', text: 'ТСД ведёт по заданию: место хранения, товар, маркировка и нужная наклейка.', detail: 'Задание → ШК → КИЗ', icon: Smartphone },
  { name: 'Отгрузка', title: 'От коробки до передачи.', text: 'Упаковка, этикетки, поставка и статус маркетплейса — последовательные этапы работы.', detail: 'Упаковка → печать → передача', icon: PackageCheck },
];
const updates = [
  ['Перемаркировка', 'Нужная этикетка прямо в процессе сборки. Печать с ТСД через подключённое рабочее место.'],
  ['Повторная отгрузка', 'Отдельная работа с заказами WB, которым нужна повторная сборка или довоз.'],
  ['Сообщения на ТСД', 'Отправьте сообщение из мониторинга. Сотрудник увидит его на экране и подтвердит прочтение.'],
  ['Скорость обработки', 'Показатели времени обработки заказов по обслуживаемым складам и филиалам.'],
];

// FIX: public-site-only redesign; preserve authentication and operational WMS screens.
export function MarketingLanding({ onLogin }: { onLogin: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [stage, setStage] = useState(1);
  const current = stages[stage];
  const StageIcon = current.icon;
  useEffect(() => {
    document.body.classList.add('logoff-site-body');
    return () => document.body.classList.remove('logoff-site-body');
  }, []);
  const login = () => { setMenuOpen(false); onLogin(); };
  return <div className="logoff-site" id="top">
    <a className="ls-skip" href="#site-content">Перейти к содержимому</a>
    <header className="ls-header"><div className="ls-container ls-nav">
      <a className="ls-brand" href="#top" aria-label="LOGOFF WMS — главная"><span className="ls-brand-mark" aria-hidden="true">L<span /></span><strong>LOGOFF<span>WMS</span></strong></a>
      <nav id="ls-navigation" className={`ls-navigation${menuOpen ? ' is-open' : ''}`} aria-label="Основная навигация">
        <a href="#capabilities" onClick={() => setMenuOpen(false)}>Возможности</a><a href="#workspace" onClick={() => setMenuOpen(false)}>Интерфейс</a><a href="#downloads" onClick={() => setMenuOpen(false)}>Приложения</a><a href="#contact" onClick={() => setMenuOpen(false)}>Обсудить внедрение <ArrowUpRight size={14} /></a>
      </nav>
      <button className="ls-login" onClick={login}>Войти в WMS <ArrowUpRight size={17} /></button>
      <button className="ls-menu" type="button" aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'} aria-expanded={menuOpen} aria-controls="ls-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
    </div></header>
    <main id="site-content">
      <section className="ls-hero ls-container" aria-labelledby="ls-title">
        <div className="ls-hero-copy"><p className="ls-eyebrow"><span className="ls-square" /> Система управления фулфилментом</p>
          <h1 id="ls-title">Каждый товар.<br /><span>На своём<br className="ls-desktop-break" /> месте.</span></h1>
          <p className="ls-lead">От первого сканирования до отгрузки.<br />LOGOFF объединяет склад, маркетплейсы и команду в один понятный процесс.</p>
          <div className="ls-hero-actions"><a className="ls-button" href="#contact">Обсудить ваш склад <ArrowUpRight size={20} /></a><a className="ls-text-link" href="#workspace">Посмотреть систему <ArrowDown size={17} /></a></div>
          <div className="ls-hero-note"><span className="ls-mini-barcode" aria-hidden="true" /><p>Создана в собственном фулфилменте.<br /><strong>Для реальной работы, каждый день.</strong></p></div>
        </div>
        <div className="ls-flow" aria-label="Интерактивная схема движения товара">
          <div className="ls-flow-heading"><span>LOGOFF / ДВИЖЕНИЕ ТОВАРА</span><span>WMS ↗</span></div>
          <div className={`ls-map ls-map--${stage}`}>
            <svg className="ls-map-lines" viewBox="0 0 600 350" fill="none" aria-hidden="true"><path d="M55 210 300 70 545 210 300 350Z" fill="#e4ebee" /><path d="m55 170 245 140 245-140M55 130l245 140 245-140M140 82l245 140M215 40l245 140" stroke="#c6d4da" /><path className="ls-route" d="m88 240 115-66 91 51 122-69 92 52" stroke="#cf3547" strokeWidth="3" strokeDasharray="6 7" /></svg>
            <div className="ls-racks" aria-hidden="true">{[0, 1, 2].map(row => <div className="ls-rack" key={row}>{[0, 1, 2, 3, 4, 5].map(box => <i key={box} />)}</div>)}</div>
            <div className="ls-map-label ls-map-label--a"><span>ПРИЁМКА</span><Box size={22} /></div><div className="ls-map-label ls-map-label--b"><PackageCheck size={22} /><span>ОТГРУЗКА</span></div>
            <div className="ls-scan-marker"><ScanBarcode size={24} /><span>Товар найден<small>Короб · паллетсорт · филиал</small></span><Check size={16} /></div><span className="ls-map-coordinate">СХЕМА СКЛАДСКОГО ПРОЦЕССА</span>
          </div>
          <div className="ls-stage-selector" role="group" aria-label="Этап движения товара">{stages.map((item, index) => <button key={item.name} type="button" aria-pressed={stage === index} onClick={() => setStage(index)}><span>0{index + 1}</span>{item.name}</button>)}</div>
          <div className="ls-stage-detail" aria-live="polite" aria-atomic="true"><span className="ls-stage-icon"><StageIcon size={23} /></span><div><h2>{current.title}</h2><p>{current.text}</p><small>{current.detail}</small></div></div>
        </div>
      </section>
      <div className="ls-ecosystem ls-container"><span>Один рабочий контур</span><strong>Wildberries</strong><strong>Ozon</strong><i /><span>FBS / FBO</span><span>КИЗ и маркировка</span><span>Веб + ТСД</span></div>
      <section className="ls-section ls-container" id="capabilities" aria-labelledby="ls-capabilities-title">
        <div className="ls-section-heading"><p className="ls-eyebrow">Не набор отдельных программ</p><h2 id="ls-capabilities-title">Склад — сложный.<br />Работа с ним — <span>понятная.</span></h2><p>Система связывает физический товар, действия сотрудников и документы. Каждый этап продолжает предыдущий.</p></div>
        <div className="ls-capabilities">
          <article className="ls-capability ls-capability--storage"><span className="ls-category">Склад и остатки</span><Boxes size={32} /><h3>Не просто количество.<br />Место, состав и история.</h3><p>Принимайте товар, размещайте короба на паллетсортах, перемещайте между филиалами и проверяйте фактическое наличие.</p><div className="ls-address"><span>Филиал</span><ChevronRight /><span>Паллетсорт</span><ChevronRight /><span>Короб</span><ChevronRight /><strong>Товар</strong></div></article>
          <article className="ls-capability"><span className="ls-category">FBS и FBO</span><PackageCheck size={32} /><h3>От заказа<br />до готовой поставки.</h3><p>Заявки, подбор, упаковка, грузоместа и этикетки. Отдельные сценарии для поштучных заказов и поставок на склад маркетплейса.</p><div className="ls-tags"><span>Wildberries</span><span>Ozon</span><span>Статусы и готовность</span></div></article>
          <article className="ls-capability"><span className="ls-category">Команда и клиенты</span><Smartphone size={32} /><h3>Каждому —<br />своё рабочее место.</h3><p>Сборщику — задание на ТСД. Менеджеру — мониторинг операций. Клиенту — доступ к своим остаткам, заявкам и документам.</p><div className="ls-tags"><span>Филиалы</span><span>Роли и доступы</span><span>История действий</span></div></article>
          <article className="ls-capability ls-capability--finance"><span className="ls-category">Финансы и контроль</span><span className="ls-ruble" aria-hidden="true">₽</span><h3>Работа сделана.<br />Услуги учтены.</h3><p>Первичная обработка, хранение и дополнительные услуги. Формируйте счета за период, объединяйте документы и контролируйте оплаты.</p><div className="ls-tags"><span>Тарифы клиента</span><span>Счета и акты</span><span>Отчёты</span></div></article>
        </div>
      </section>
      <section className="ls-updates-band" aria-labelledby="ls-updates-title"><div className="ls-container ls-updates-layout"><div><p className="ls-eyebrow">Развивается вместе со складом</p><h2 id="ls-updates-title">Детали, которые<br />меняют смену.</h2><p>Новые инструменты для ситуаций, с которыми команда сталкивается в ежедневной работе.</p><a className="ls-text-link" href="#downloads">Инструменты для команды <ArrowDown size={17} /></a></div><div className="ls-updates">{updates.map(([title, text]) => <article key={title}><span className="ls-update-mark" aria-hidden="true">+</span><div><h3>{title}</h3><p>{text}</p></div></article>)}</div></div></section>
      <section className="ls-section ls-container" id="workspace" aria-labelledby="ls-workspace-title">
        <div className="ls-preview-heading"><div><p className="ls-eyebrow">Знакомьтесь с LOGOFF</p><h2 id="ls-workspace-title">Одна система.<br />Для каждой роли.</h2></div><p>От общего обзора до конкретного короба.<br />Рабочий интерфейс в теме «Современная».</p></div>
        <div className="ls-preview"><figure><div className="ls-window-bar"><span /><span /><span /><small>LOGOFF WMS / СОВРЕМЕННАЯ</small></div><img src="/images/wms-theme-modern.png" alt="Экран FBS LOGOFF WMS в теме Современная: выбор маркетплейса" loading="lazy" width="1280" height="720" /><figcaption>Демонстрация интерфейса · тема «Современная»</figcaption></figure><div className="ls-preview-copy"><h3>Всё на своём месте.<br />В интерфейсе тоже.</h3><p>Разделы склада, заказы маркетплейсов и кабинет клиента — в единой системе. Доступ к операциям определяется ролью сотрудника.</p><ul><li><Check size={17} />Руководителю — обзор филиалов</li><li><Check size={17} />Команде — задачи и операции</li><li><Check size={17} />Клиенту — свои остатки и документы</li></ul><button className="ls-text-link" onClick={login}>Войти в свой кабинет <ArrowRight size={17} /></button></div></div>
      </section>
      <section className="ls-downloads ls-container" id="downloads" aria-labelledby="ls-downloads-title"><div className="ls-downloads-heading"><p className="ls-eyebrow">Работайте там, где товар</p><h2 id="ls-downloads-title">Компьютер. Сканер.<br /><span>Один процесс.</span></h2><p>Веб-кабинет для управления, Android-приложения для склада и агент для печати с рабочего места.</p><span className="ls-install-note">Для работы нужна учётная запись WMS.<br />Доступы и оборудование настраивает администратор.</span></div><div className="ls-download-list">
        <a href="/downloads/logoff-tsd.apk" download><span className="ls-download-icon"><ScanBarcode /></span><span><strong>LOGOFF ТСД</strong><small>Android · приёмка, сборка, КИЗ</small></span><Download size={21} /></a>
        <a href="/downloads/logoff-wms-mobile.apk" download><span className="ls-download-icon"><Smartphone /></span><span><strong>LOGOFF WMS</strong><small>Android · мобильный доступ</small></span><Download size={21} /></a>
        <a href="/downloads/LOGOFF-FBS-Print-Agent.zip" download><span className="ls-download-icon"><Printer /></span><span><strong>Агент печати</strong><small>Windows · печать этикеток</small></span><Download size={21} /></a>
      </div></section>
      <section className="ls-contact ls-container" id="contact" aria-labelledby="ls-contact-title"><div className="ls-contact-top"><span className="ls-eyebrow">Ваш склад → LOGOFF WMS</span><span>Давайте обсудим</span></div><div className="ls-contact-main"><h2 id="ls-contact-title">Навести порядок.<br /><span>И двигаться дальше.</span></h2><div><p>Расскажите о своём фулфилменте.<br />Разберём процессы, филиалы и задачи команды — и обсудим внедрение.</p><a href="tel:+79267250205">+7 926 725-02-05 <ArrowUpRight size={25} /></a><a className="ls-contact-secondary" href="https://logoff.pro" target="_blank" rel="noreferrer">О фулфилменте LOGOFF <ArrowUpRight size={15} /></a></div></div><div className="ls-contact-bottom"><span>Москва · ул. Приречная, 1к1</span><span>Создано людьми, которые работают на складе.</span></div></section>
    </main>
    <footer className="ls-footer ls-container"><a className="ls-brand" href="#top"><strong>LOGOFF<span>WMS</span></strong></a><span>Товар. Команда. Порядок.</span><button className="ls-text-link" onClick={login}>Войти в WMS <ArrowUpRight size={17} /></button><a className="ls-back-top" href="#top">Наверх ↑</a></footer>
  </div>;
}
