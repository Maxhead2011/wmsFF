import {
  ArrowRight,
  BadgeCheck,
  BellRing,
  Box,
  Boxes,
  BrainCircuit,
  Check,
  ChevronRight,
  ClipboardCheck,
  Download,
  Factory,
  FileSpreadsheet,
  MapPin,
  MessageCircle,
  PackageCheck,
  Phone,
  Printer,
  ScanBarcode,
  Server,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Truck,
  Warehouse,
} from 'lucide-react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useEffect, useRef, type ReactNode } from 'react';
import './marketing-landing.css';

gsap.registerPlugin(useGSAP, ScrollTrigger);

type MarketingLandingProps = {
  onLogin: () => void;
};

const menuItems = [
  'Сегодня', 'Операции', 'Клиенты', 'Финансы', 'Управление', 'Контроль', 'Отчёты', 'Настройки',
];

const fbsOrders = [
  ['5426435634', 'Корея_2голубой · M', 'Москва', '11:42', 'green'],
  ['5426361041', 'Корея_2бежевый · L', 'Казань', '13:18', 'amber'],
  ['5426361044', 'Новый_корея_2голубой · XL', 'Москва', '19:08', 'red'],
  ['59639100-0681-1', 'Худи базовое · S', 'Краснодар', '08:51', 'green'],
];

export function MarketingLanding({ onLogin }: MarketingLandingProps) {
  const pageRef = useRef<HTMLElement>(null);
  const portalCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    document.body.classList.add('marketing-body');
    return () => document.body.classList.remove('marketing-body');
  }, []);

  useEffect(() => {
    const canvas = portalCanvasRef.current;
    const hero = canvas?.parentElement;
    if (!canvas || !hero) return undefined;

    const finePointer = window.matchMedia('(pointer: fine) and (min-width: 860px)');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const context = canvas.getContext('2d');
    if (!context) return undefined;

    type Trace = { x: number; y: number; born: number; strength: number; angle: number };
    let frame = 0;
    let dpr = 1;
    let width = 0;
    let height = 0;
    let running = false;
    let lastDrop = { x: -1000, y: -1000, time: 0 };
    let traces: Trace[] = [];

    const canAnimate = () => finePointer.matches && !reducedMotion.matches;

    const drawWaterRing = (ctx: CanvasRenderingContext2D, trace: Trace, radius: number, alpha: number) => {
      const yRadius = radius * 0.42;
      ctx.save();
      ctx.lineWidth = 2.1;
      ctx.strokeStyle = `rgba(1, 10, 28, ${alpha * 0.46})`;
      ctx.beginPath();
      ctx.ellipse(trace.x, trace.y + 1.8, radius, yRadius, trace.angle * 0.08, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 0.85;
      ctx.strokeStyle = `rgba(218, 244, 255, ${alpha})`;
      ctx.beginPath();
      ctx.ellipse(trace.x, trace.y - 0.7, radius, yRadius, trace.angle * 0.08, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    };

    const drawLogoffTrace = (ctx: CanvasRenderingContext2D, trace: Trace, time: number) => {
      const life = 1550;
      const age = time - trace.born;
      const progress = age / life;
      if (progress >= 1) return false;

      const fade = (1 - progress) ** 2.15;
      const radius = 10 + progress * 124 * trace.strength;
      drawWaterRing(ctx, trace, radius, 0.28 * fade);
      drawWaterRing(ctx, trace, radius * 0.61, 0.16 * fade);

      const scale = (0.81 + progress * 0.17) * trace.strength;
      const wobble = Math.sin(time * 0.006 + trace.x * 0.012) * 0.7 * fade;
      const y = trace.y - progress * 8 + wobble;
      ctx.save();
      ctx.translate(trace.x, y);
      ctx.rotate(trace.angle * 0.11);
      ctx.scale(scale, scale);
      ctx.font = '900 17px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      const glass = ctx.createLinearGradient(0, -13, 0, 15);
      glass.addColorStop(0, `rgba(229, 248, 255, ${0.46 * fade})`);
      glass.addColorStop(0.38, `rgba(125, 188, 222, ${0.14 * fade})`);
      glass.addColorStop(0.7, `rgba(15, 65, 112, ${0.34 * fade})`);
      glass.addColorStop(1, `rgba(201, 241, 255, ${0.2 * fade})`);
      for (let depth = 4; depth > 0; depth -= 1) {
        ctx.fillStyle = `rgba(3, 20, 48, ${0.11 * fade})`;
        ctx.fillText('LOGOFF', depth * 0.7, depth * 0.75);
      }
      ctx.fillStyle = glass;
      ctx.fillText('LOGOFF', 0, 0);
      ctx.lineWidth = 0.7;
      ctx.strokeStyle = `rgba(239, 253, 255, ${0.35 * fade})`;
      ctx.strokeText('LOGOFF', 0, 0);
      ctx.globalAlpha = 0.12 * fade;
      ctx.scale(1, -0.56);
      ctx.fillStyle = '#c5ebf9';
      ctx.fillText('LOGOFF', 0, 25);
      ctx.restore();
      return true;
    };

    const render = (time: number) => {
      frame = 0;
      if (!canAnimate()) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        running = false;
        return;
      }

      context.clearRect(0, 0, canvas.width, canvas.height);
      context.save();
      context.scale(dpr, dpr);
      traces = traces.filter((trace) => drawLogoffTrace(context, trace, time));
      context.restore();

      if (traces.length > 0) {
        frame = window.requestAnimationFrame(render);
      } else {
        running = false;
      }
    };

    const requestRender = () => {
      if (running || !canAnimate()) return;
      running = true;
      frame = window.requestAnimationFrame(render);
    };

    const resize = () => {
      const bounds = hero.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.round(bounds.width));
      height = Math.max(1, Math.round(bounds.height));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };

    const onMove = (event: PointerEvent) => {
      const bounds = hero.getBoundingClientRect();
      const now = performance.now();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      const distance = Math.hypot(x - lastDrop.x, y - lastDrop.y);
      if (distance > 52 || now - lastDrop.time > 150) {
        const angle = Math.atan2(y - lastDrop.y, x - lastDrop.x);
        traces.push({ x, y, born: now, strength: Math.min(1.12, 0.78 + distance / 210), angle: Number.isFinite(angle) ? angle : 0 });
        traces = traces.slice(-9);
        lastDrop = { x, y, time: now };
      }
      requestRender();
    };
    const onMediaChange = () => {
      if (!canAnimate()) {
        traces = [];
        if (frame) window.cancelAnimationFrame(frame);
        frame = 0;
        running = false;
        context.clearRect(0, 0, canvas.width, canvas.height);
      } else {
        resize();
      }
    };

    const observer = new ResizeObserver(resize);
    observer.observe(hero);
    hero.addEventListener('pointermove', onMove, { passive: true });
    finePointer.addEventListener('change', onMediaChange);
    reducedMotion.addEventListener('change', onMediaChange);
    resize();

    return () => {
      observer.disconnect();
      hero.removeEventListener('pointermove', onMove);
      finePointer.removeEventListener('change', onMediaChange);
      reducedMotion.removeEventListener('change', onMediaChange);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  useGSAP(() => {
    const media = gsap.matchMedia();

    media.add(
      {
        desktop: '(min-width: 860px)',
        reduceMotion: '(prefers-reduced-motion: reduce)',
      },
      (context) => {
        if (context.conditions?.reduceMotion) return undefined;

        const hero = gsap.timeline({ defaults: { ease: 'power3.out' } });
        hero
          .from('.marketing-nav', { y: -18, autoAlpha: 0, duration: 0.55 })
          .from('.marketing-hero__content > *', { y: 26, autoAlpha: 0, duration: 0.72, stagger: 0.09 }, '-=0.12')
          .from('.hero-screen', { x: 46, y: 20, rotationY: -2, autoAlpha: 0, duration: 0.95 }, '-=0.62')
          .from('.marketing-float-card', { y: 18, scale: 0.95, autoAlpha: 0, duration: 0.5, stagger: 0.14 }, '-=0.38');

        const revealTargets = pageRef.current?.querySelectorAll<HTMLElement>('.marketing-reveal') ?? [];
        ScrollTrigger.batch(revealTargets, {
          start: 'top 86%',
          once: true,
          onEnter: (targets) => gsap.fromTo(
            targets,
            { y: 32, autoAlpha: 0 },
            { y: 0, autoAlpha: 1, duration: 0.7, ease: 'power3.out', stagger: 0.09, overwrite: 'auto' },
          ),
        });

        if (context.conditions?.desktop) {
          gsap.to('.marketing-hero__visual', {
            y: -28,
            ease: 'none',
            scrollTrigger: { trigger: '.marketing-hero', start: 'top top', end: 'bottom top', scrub: 0.7 },
          });
          gsap.to('.marketing-fbo__graphic', {
            y: -20,
            ease: 'none',
            scrollTrigger: { trigger: '.marketing-fbo', start: 'top bottom', end: 'bottom top', scrub: 0.8 },
          });
        }

        return undefined;
      },
    );

    return () => media.revert();
  }, { scope: pageRef });

  return (
    <main className="marketing-page" ref={pageRef}>
      <section className="marketing-hero" id="top">
        <nav className="marketing-nav" aria-label="Основная навигация">
          <a className="marketing-brand" href="#top" aria-label="LOGOFF WMS">
            <strong>LOGOFF</strong><span>WMS</span>
          </a>
          <div className="marketing-nav__links">
            <a href="#capabilities">Возможности</a>
            <a href="#warehouse">Склад</a>
            <a href="#tsd">ТСД и печать</a>
            <a href="#implementation">Как внедряем</a>
          </div>
          <div className="marketing-nav__contact" aria-label="Контакты LOGOFF">
            <span><MapPin size={15} /> г. Москва · ул. Приречная 1к1</span>
            <a href="tel:+79267250205"><Phone size={15} /> +7 926 725-02-05</a>
          </div>
          <div className="marketing-nav__actions">
            <a className="marketing-link-button" href="https://logoff.pro" target="_blank" rel="noreferrer">logoff.pro</a>
            <button className="marketing-login" type="button" onClick={onLogin}>Войти в WMS</button>
          </div>
        </nav>

        <div className="marketing-hero__grid">
          <div className="marketing-hero__content">
            <p className="marketing-kicker"><Sparkles size={15} /> WMS для фулфилмента, который растёт</p>
            <h1>Управляйте складом.<br /><em>Знайте, где каждый товар.</em></h1>
            <p className="marketing-hero__lead">
              LOGOFF WMS собирает приёмку, адресное хранение, FBS/FBO, логистику, КИЗ, счета и работу филиалов
              в одном контуре. Видите реальный товар, реальную задачу и ответственного — в моменте.
            </p>
            <div className="marketing-hero__actions">
              <button className="marketing-button marketing-button--primary" type="button" onClick={onLogin}>
                Открыть WMS <ArrowRight size={18} />
              </button>
              <a className="marketing-button marketing-button--quiet" href="#warehouse">Посмотреть возможности <ChevronRight size={18} /></a>
            </div>
            <div className="marketing-hero__scene-note" aria-hidden="true">
              <span>LOGOFF / WMS</span><i /><span>Операционный контур</span>
            </div>
            <div className="marketing-trust">
              <span><MapPin size={16} /> Свой фулфилмент: Приречная 1к1</span>
              <span><BadgeCheck size={16} /> Решение из ежедневной складской практики</span>
            </div>
          </div>

          <div className="marketing-hero__visual marketing-hero__visual--real" aria-label="Настоящий экран LOGOFF WMS в безопасном демонстрационном контуре">
              <div className="marketing-hero__theme-stage" aria-label="Настоящий демонстрационный экран LOGOFF WMS в нескольких темах">
                <img className="marketing-hero__theme-frame marketing-hero__theme-frame--classic" src="/images/wms-theme-classic.png" alt="Демонстрационный экран LOGOFF WMS в классической теме" />
                <img className="marketing-hero__theme-frame marketing-hero__theme-frame--modern" src="/images/wms-theme-modern.png" alt="" />
                <img className="marketing-hero__theme-frame marketing-hero__theme-frame--future" src="/images/wms-theme-future.png" alt="" />
                <div className="marketing-hero__theme-status" aria-hidden="true">
                  <span className="marketing-hero__theme-mark">3 темы интерфейса</span>
                  <strong className="marketing-hero__theme-name marketing-hero__theme-name--classic">Классическая</strong>
                  <strong className="marketing-hero__theme-name marketing-hero__theme-name--modern">Современная</strong>
                  <strong className="marketing-hero__theme-name marketing-hero__theme-name--future">Future</strong>
                </div>
              </div>
            <div className="hero-screen">
              <div className="hero-screen__bar"><span className="hero-screen__dot" /><span className="hero-screen__dot" /><span className="hero-screen__dot" /><b>LOGOFF WMS · Сегодня</b><i>Москва · ФФ Москва</i></div>
              <div className="hero-screen__body">
                <aside className="hero-screen__menu">
                  <div className="hero-screen__logo"><strong>LOGOFF</strong> WMS</div>
                  {menuItems.slice(0, 6).map((item, index) => <span className={index === 0 ? 'is-active' : ''} key={item}>{index === 0 ? <Box size={14} /> : <ChevronRight size={14} />}{item}{index === 1 ? <b>12</b> : null}</span>)}
                </aside>
                <div className="hero-screen__dashboard">
                  <div className="hero-screen__topline"><div><small>ОПЕРАЦИОННЫЙ ЦЕНТР</small><h2>Сегодня</h2></div><div className="hero-screen__search">⌕&nbsp;&nbsp; Найти заказ, товар, короб или КИЗ</div></div>
                  <div className="hero-metrics">
                    <Metric icon={<Truck />} value="128" label="FBS к сборке" color="red" />
                    <Metric icon={<ScanBarcode />} value="18" label="Проблемы КИЗ" color="amber" />
                    <Metric icon={<Boxes />} value="24 560" label="SKU на остатках" color="violet" />
                    <Metric icon={<FileSpreadsheet />} value="7" label="Счета к проверке" color="blue" />
                  </div>
                  <div className="hero-screen__columns">
                    <article className="hero-queue"><header><b>Очередь на сегодня</b><span>Все операции</span></header>
                      <QueueRow icon={<Truck />} title="FBS отгрузка" note="36 заказов" value="02:15:47" danger />
                      <QueueRow icon={<ClipboardCheck />} title="Проверка коробов" note="12 задач" value="01:42:11" />
                      <QueueRow icon={<Box />} title="Приёмка" note="18 поставок" value="03:25:33" />
                    </article>
                    <article className="hero-branches"><header><b>Филиалы</b><span>Все филиалы</span></header>
                      <BranchMini city="Москва" data="1 284 · 1 732 · 24 560 SKU" progress="68" />
                      <BranchMini city="Краснодар" data="612 · 846 · 11 230 SKU" progress="52" />
                    </article>
                  </div>
                </div>
              </div>
            </div>
            <div className="marketing-float-card marketing-float-card--stock"><span>Синхронизация WB</span><strong><i /> Остатки в норме</strong><small>проверено 2 мин назад</small></div>
            <div className="marketing-float-card marketing-float-card--kiz"><ShieldCheck /><span>КИЗ под контролем</span><b>18</b></div>
          </div>
        </div>
        <div className="marketing-hero__ledger" aria-label="Ключевые возможности LOGOFF WMS">
          <span>FBS · WB / Ozon / Яндекс</span>
          <span>ТCД · КИЗ · тихая печать</span>
          <span>Ваш VPS · ваши данные</span>
        </div>
      </section>

      <section className="marketing-pain" aria-labelledby="pain-title">
        <div className="marketing-section-heading"><p>ЗНАКОМАЯ КАРТИНА?</p><h2 id="pain-title">Когда WMS ещё нет, склад растёт быстрее, чем управляемость.</h2></div>
        <div className="marketing-pain__grid marketing-reveal">
          <Pain title="Остаток есть только «на словах»" text="Продали товар из пустого короба, резерв забыли, а клиент увидел минус уже после сборки." />
          <Pain title="Заказ теряется между людьми" text="Кто взял заявку, где она лежит, какой КИЗ наклеили — приходится выяснять в чате." />
          <Pain title="Филиалы смешаны" text="Сотрудник видит чужой город, а администратор не может быстро понять, где товар на самом деле." />
          <Pain title="Деньги считают вручную" text="Нулевые счета, дубли услуг, непонятная логистика и часы сверки вместо работы с клиентами." />
        </div>
        <p className="marketing-pain__answer"><Check size={18} /> LOGOFF WMS делает каждое движение товара и каждую операцию видимыми, проверяемыми и привязанными к человеку, месту и клиенту.</p>
      </section>

      <section className="marketing-capabilities" id="capabilities">
        <div className="marketing-section-heading marketing-section-heading--split"><div><p>ЕДИНЫЙ КОНТУР</p><h2>Всё, что нужно фулфилменту — без лишних экранов.</h2></div><p>Вы сами выбираете, какие роли и процессы включать. Сотрудник видит только свою работу, администратор — всю картину.</p></div>
        <div className="marketing-capability-grid marketing-reveal">
          <Feature icon={<Truck />} tag="FBS" title="WB · Ozon · Яндекс" text="Заказы приходят, резервируют товар и делятся по складу WB. Собирайте, печатайте, сдавайте и контролируйте таймеры." />
          <Feature icon={<Warehouse />} tag="СКЛАД" title="Адресное хранение" text="Короб → паллетосорт → зона → стеллаж → ячейка. В поиске видно, где лежит товар и в каком городе он доступен." />
          <Feature icon={<Factory />} tag="ФИЛИАЛЫ" title="Города без путаницы" text="Свои остатки и сотрудники для Москвы, Краснодара и других филиалов. Перемещение становится понятной операцией приёмки." />
          <Feature icon={<ShieldCheck />} tag="КИЗ" title="Проблемы решаются в интерфейсе" text="Конфликт, неверный товар, повторный КИЗ или фантомный остаток — система создаёт задачу, показывает причину и вариант исправления." />
          <Feature icon={<BrainCircuit />} tag="ИИ" title="Вопрос — ответ — Excel" text="Спросите, какие короба не попали в паллетосорт или где лежит Корея_2голубой до 30 шт. Получите список и выгрузку." />
          <Feature icon={<FileSpreadsheet />} tag="БИЛЛИНГ" title="Счета, услуги и оплата" text="FBS, FBO, ПРР, логистика и первичная обработка. Объединяйте счета, задавайте цены клиента и контролируйте оплату." />
        </div>
      </section>

      <section className="marketing-showcase" id="warehouse">
        <div className="marketing-showcase__copy"><p className="marketing-kicker"><Warehouse size={15} /> ОСТАТКИ, КОТОРЫМ МОЖНО ВЕРИТЬ</p><h2>Не просто «100 штук на складе».<br />А точный путь каждой единицы.</h2><p>Когда приходит FBS-заказ, WMS сразу резервирует товар именно там, где его можно взять. Если клиент хранится без коробов — работает по доступному остатку. Если в коробах — ТСД ведёт сборщика к нужному месту.</p><ul><li><Check /> Несколько вариантов коробов и паллетосортов для одной позиции</li><li><Check /> Контроль пустых коробов и фантомных остатков</li><li><Check /> Видимые резервы, перемещения и история каждой единицы</li></ul></div>
        <div className="warehouse-demo marketing-reveal warehouse-demo--real">
          <img src="/images/wms-demo-warehouse.png" alt="Настоящий экран онлайн-приёмки и управления коробами в LOGOFF WMS" />
          <div className="warehouse-demo__toolbar"><b>Товарооборот</b><div>⌕&nbsp; Корея_2голубой</div><button>Экспорт XLSX</button></div>
          <div className="warehouse-demo__product"><span className="warehouse-demo__cube"><Box /></span><div><strong>Корея_2голубой · M</strong><small>Артикул KOR-2-BL · ШК 2037429017328</small></div><b className="warehouse-demo__qty">24 <small>доступно</small></b></div>
          <div className="warehouse-demo__locations"><p>Где лежит товар</p><Location city="Москва" place="FFL_LKB79_402 · Паллетосорт P-04" zone="A-05 · стеллаж 02 · ячейка 03" quantity="12 шт." /> <Location city="Москва" place="FFL_LKB2807_01 · Паллетосорт P-09" zone="A-08 · стеллаж 01 · ячейка 04" quantity="8 шт." /> <Location city="Краснодар" place="FFL_KRD120_011 · зона приёмки" zone="B-02 · стеллаж 04 · ячейка 01" quantity="4 шт." /></div>
          <div className="warehouse-demo__reservation"><PackageCheck size={18} /><span>FBS №000122</span><strong>2 шт. зарезервировано</strong><small>WB · Москва</small></div>
        </div>
      </section>

      <section className="marketing-fbs">
        <div className="marketing-section-heading marketing-section-heading--center"><p>FBS БЕЗ СЮРПРИЗОВ</p><h2>Заказы распределяются, а не «висят в общей куче».</h2><span>Склады WB, города исполнения, фактическое место сдачи, сотрудник и дедлайн — всё видно до начала сборки.</span></div>
        <figure className="fbs-demo fbs-demo--real"><img src="/images/wms-demo-marketplaces.png" alt="Настоящий экран выбора FBS-контура Wildberries, Ozon и Яндекс Маркета" /><figcaption>Настоящий экран WMS: отдельные рабочие контуры FBS для каждого маркетплейса.</figcaption></figure>
      </section>

      <section className="marketing-tsd" id="tsd">
        <div className="tsd-phone"><div className="tsd-phone__notch" /><div className="tsd-phone__screen"><div className="tsd-appbar"><strong>ТСД</strong><span>Администратор</span></div><p>Сборка FBS</p><h3>Заявка №000122</h3><div className="tsd-order"><small>ЗАКАЗ WB · МОСКВА</small><b>5426435634</b><span>Корея_2голубой · M</span><em>Короб: FFL_LKB79_402</em></div><div className="tsd-scan"><ScanBarcode /><strong>Сканируйте ШК товара</strong><span>КИЗ потребуется после товара</span></div><button>Тихая печать наклеек</button><div className="tsd-progress"><i /><span>1 из 2</span></div></div></div>
        <div className="marketing-tsd__copy"><p className="marketing-kicker"><Smartphone size={15} /> ПРИЛОЖЕНИЯ ДЛЯ СКЛАДА</p><h2>Сотрудник не ищет инструкцию.<br />ТСД ведёт его по операции.</h2><p>Отдельное автономное приложение для ТСД работает с приёмкой, коробами, перемещениями, инвентаризацией, FBS и FBO. Очередь показывает только актуальные задания; собранное уходит в архив.</p><div className="tsd-features"><div><ScanBarcode /><span><b>Сканирование без лишних шагов</b><small>ШК, КИЗ, короб, паллета и ячейка</small></span></div><div><Printer /><span><b>Bluetooth-печать NIIMBOT B1</b><small>Стикер WB/Ozon 50×30 мм и второй ярлык: заявка, заказ, склад</small></span></div><div><ClipboardCheck /><span><b>Инвентаризация и проверка коробов</b><small>Результат виден менеджеру, завершённые проверки — в архиве</small></span></div></div><div className="label-preview"><div><b>WB</b><span>5432705284</span><i>QR</i></div><div><b>Заявка №000122</b><span>Заказ 5432705284</span><small>Склад: Москва</small></div><ArrowRight /><Printer /></div></div>
      </section>

      <section className="marketing-process" id="implementation"><div className="marketing-section-heading marketing-section-heading--center"><p>ОТ ПЕРВОГО КОРОБА ДО ОТГРУЗКИ</p><h2>Складской процесс становится последовательным.</h2></div><div className="process-steps"><Process number="01" title="Приёмка" text="Сканируем товар, КИЗ и короба. Загружаем Excel/PDF реквизитов и составов." icon={<Box />} /><Process number="02" title="Размещение" text="Привязываем короб к паллетосорту, зоне, стеллажу и ячейке." icon={<Warehouse />} /><Process number="03" title="Резерв FBS" text="Заказ с WB/Ozon/YM сразу занимает доступный остаток." icon={<PackageCheck />} /><Process number="04" title="Сборка ТСД" text="ТСД показывает короб, товар, КИЗ, город и наклейку маркетплейса." icon={<ScanBarcode />} /><Process number="05" title="Упаковка и сдача" text="Печать, грузоместо, QR поставки и контроль перед передачей." icon={<Truck />} /><Process number="06" title="Счёт и аналитика" text="Услуги, логистика, первичная обработка, оплаты и отчёты клиенту." icon={<FileSpreadsheet />} /></div></section>

      <section className="marketing-fbo"><div className="marketing-fbo__graphic"><div className="fbo-card fbo-card--one"><small>FBO · OZON</small><strong>Поставка №OZ-10487</strong><span>42 короба · 1 284 ед.</span><i>Собирается</i></div><div className="fbo-card fbo-card--two"><small>FBO · WILDBERRIES</small><strong>Поставка WB-GI-261928866</strong><span>18 коробов · QR готов</span><i>Готово к сдаче</i></div><div className="fbo-flow"><span><Box /></span><b>Сканируем товар<br />и считаем факт</b><ArrowRight /><span><Boxes /></span><b>Собираем<br />в короб</b><ArrowRight /><span><Truck /></span></div></div><div className="marketing-fbo__copy"><p className="marketing-kicker"><Sparkles size={15} /> FBO БЕЗ РУЧНЫХ ТАБЛИЦ</p><h2>Поставки FBO, которые собираются по факту, а не по догадке.</h2><p>Для Ozon и Wildberries WMS ведёт от плана поставки до последней коробки: выбирает клиента, показывает нужный товар, контролирует количество, закрывает короб и готовит документы для сдачи.</p><p>На ТСД сотрудник видит только следующую нужную операцию. Менеджер — весь прогресс поставки и расхождения в одном экране.</p></div></section>

      <section className="marketing-themes"><div className="marketing-section-heading marketing-section-heading--split"><div><p>ИНТЕРФЕЙС ПОД РОЛЬ И ВКУС</p><h2>Несколько тем. Одна рабочая WMS.</h2></div><p>Сотрудник или клиент выбирает оформление для себя — таблицы, права и процессы при этом остаются одинаковыми.</p></div><div className="theme-showcase"><ThemePreview name="Классическая" caption="Привычная рабочая" tone="classic" /><ThemePreview name="Современная" caption="Чистая и контрастная" tone="modern" active /><ThemePreview name="Aerospace" caption="Светлый hi-tech" tone="aerospace" /><ThemePreview name="Obsidian" caption="Тёмный командный центр" tone="obsidian" /><ThemePreview name="Polar Grid" caption="Холодная точность" tone="polar" /><ThemePreview name="Future" caption="Интерфейс будущего" tone="future" /><ThemePreview name="WingX · Эля" caption="Персональная тема" tone="wingx" /></div></section>

      <section className="marketing-proof"><div><p>НЕ ПОРОЖДЁН В ОТЧЁТЕ КОНСАЛТИНГА</p><h2>LOGOFF WMS вырос из работы собственного фулфилмента.</h2><p>Мы используем процессы на своём ФФ по адресу Приречная 1к1, поэтому в системе есть именно то, что болит в реальной смене: короб, КИЗ, паллета, город, таймер, наклейка, ошибка передачи и счёт.</p><a href="https://logoff.pro" target="_blank" rel="noreferrer">О фулфилменте LOGOFF <ArrowRight size={17} /></a></div><div className="marketing-proof__quotes"><blockquote>«Не нужно выяснять, кто собрал заказ. У каждой операции есть след, сотрудник и время.»</blockquote><blockquote>«Когда открываем новый город, не смешиваем остатки — просто подключаем филиал и работаем по его правилам.»</blockquote></div></section>

      <section className="marketing-cta"><div><p>LOGOFF WMS</p><h2>Ваша операционная система фулфилмента уже готова к работе.</h2><span>Откройте WMS, посмотрите демо-кабинет или узнайте о нашем фулфилменте.</span></div><div className="marketing-cta__actions"><button type="button" onClick={onLogin}>Войти в WMS <ArrowRight size={18} /></button><a href="https://logoff.pro" target="_blank" rel="noreferrer">Перейти на logoff.pro</a></div></section>

      <footer className="marketing-footer"><a className="marketing-brand" href="#top"><strong>LOGOFF</strong><span>WMS</span></a><span>Система управления фулфилментом</span><span><MapPin size={14} /> Приречная 1к1</span><a href="https://logoff.pro" target="_blank" rel="noreferrer">logoff.pro</a></footer>
      <section className="marketing-downloads marketing-reveal" aria-label="Приложения LOGOFF WMS">
        <div>
          <p>ПРИЛОЖЕНИЯ LOGOFF WMS</p>
          <h2>Веб-кабинет для управления. Приложения — для работы на складе.</h2>
          <span>Входите в WMS с компьютера, а на Android установите нужное приложение одним нажатием.</span>
        </div>
        <div className="marketing-downloads__actions">
          <button type="button" onClick={onLogin}>Войти в WMS <ArrowRight size={18} /></button>
          <a href="/downloads/logoff-wms-mobile.apk" download><Download size={18} /><span>Приложение WMS<small>Android</small></span></a>
          <a href="/downloads/logoff-tsd.apk" download><Download size={18} /><span>Приложение ТСД<small>Android · склад</small></span></a>
        </div>
      </section>
      <section className="marketing-screen-gallery marketing-reveal" aria-labelledby="screens-title">
        <div className="marketing-section-heading marketing-section-heading--center">
          <p>РЕАЛЬНЫЕ РАБОЧИЕ ЭКРАНЫ</p>
          <h2 id="screens-title">Вид меню, заказы, склад и ТСД — без лишних переходов.</h2>
          <span>Каждый экран создан по логике действующей WMS: сотрудник видит только нужную операцию, администратор — весь контур.</span>
        </div>
        <div className="screen-gallery__grid">
          <article className="screen-gallery__screen screen-gallery__screen--workspace screen-gallery__screen--real">
            <img src="/images/wms-demo-overview.png" alt="Настоящий экран обзора с полным меню LOGOFF WMS" />
            <aside><b><i>LOGOFF</i> WMS</b><span className="is-current">◈ Сегодня</span><span>▣ Приёмка</span><span>◫ Размещение</span><span>◈ FBS</span><span>▦ FBO</span><span>▤ Товары и остатки</span><span>◎ Клиенты</span><span>₽ Биллинг</span><span>⚙ Управление</span></aside>
            <main><small>ОПЕРАЦИОННЫЙ ЦЕНТР · МОСКВА</small><h3>Сегодня</h3><div className="screen-gallery__metrics"><b>128<small>FBS в сборке</small></b><b>18<small>Проблемы КИЗ</small></b><b>24 560<small>SKU на остатке</small></b></div><div className="screen-gallery__queue"><strong>Очередь на сегодня</strong><span>FBS отгрузка <b>02:15:47</b></span><span>Приёмка <b>18 поставок</b></span><span>Проверка коробов <b>12 задач</b></span></div></main>
          </article>
          <article className="screen-gallery__screen screen-gallery__screen--orders screen-gallery__screen--real">
            <img src="/images/wms-demo-fbs.png" alt="Настоящий экран FBS Wildberries в безопасном демонстрационном контуре" />
            <header><b>FBS · Wildberries</b><span>Склад WB: Москва ▾</span><button>+ Создать заявку</button></header><h3>Активные заказы</h3><div className="screen-orders__labels"><span>ЗАКАЗ WB</span><span>ТОВАР</span><span>СКЛАД</span><span>СРОК</span></div><div className="screen-orders__row"><b>5426435634</b><span>Корея_2голубой · M</span><span>Москва</span><i>11:42</i></div><div className="screen-orders__row"><b>5426361041</b><span>Корея_2бежевый · L</span><span>Казань</span><i className="is-amber">13:18</i></div><div className="screen-orders__row"><b>59639100-0681-1</b><span>Худи базовое · S</span><span>Краснодар</span><i>08:51</i></div><footer>Выбрано: 12 заказов · остатки зарезервированы</footer>
          </article>
          <article className="screen-gallery__screen screen-gallery__screen--tsd screen-gallery__screen--real"><img src="/images/wms-demo-warehouse.png" alt="Настоящий экран складской операции в LOGOFF WMS" /><div className="screen-tsd__device"><header><b>ТСД</b><span>Администратор</span></header><small>СБОРКА FBS · МОСКВА</small><h3>Заявка №000122</h3><div><span>Заказ WB</span><b>5426435634</b><em>Корея_2голубой · M</em><em>FFL_LKB79_402 · P-04</em></div><strong>▣<br />Сканируйте ШК товара</strong><button>Тихая печать наклеек</button><footer>1 из 2 · КИЗ после ШК</footer></div><p>Bluetooth NIIMBOT B1<br /><b>WB/Ozon 50×30 мм</b></p></article>
        </div>
      </section>
      <section className="marketing-client-showcase marketing-reveal" aria-labelledby="client-cabinet-title">
        <div className="marketing-section-heading marketing-section-heading--split">
          <div><p>ЛИЧНЫЙ КАБИНЕТ КЛИЕНТА</p><h2 id="client-cabinet-title">Клиент видит свой товар, заказы и деньги — без звонков менеджеру.</h2></div>
          <p>Клиент работает только со своими данными. Филиалы, остатки, документы и финансовая часть всегда разделены по правам доступа.</p>
        </div>
        <div className="client-showcase__layout">
          <div className="client-screen client-screen--real" aria-label="Настоящий кабинет клиента в безопасном демонстрационном контуре">
            <img src="/images/wms-demo-cabinet.png" alt="Настоящий экран кабинета клиента с остатками по городам" />
            <header><b><i>LOGOFF</i> WMS</b><span>Кабинет клиента · Демо-магазин</span><small>Москва · ФФ Москва ▾</small></header>
            <aside><strong>Главное</strong><span className="is-active">▦ Кабинет</span><span>▤ Заявки</span><span>▣ Остатки</span><span>◈ FBS</span><span>▧ Документы</span><span>₽ Счета и оплаты</span><span>▥ Отчёты</span></aside>
            <main><div className="client-screen__title"><div><small>МОЙ СКЛАД</small><h3>Здравствуйте!</h3></div><button>+ Создать заявку</button></div><div className="client-screen__cards"><b>1 284<small>единицы на остатке</small></b><b>24<small>короба на складе</small></b><b>16<small>FBS-заказов в работе</small></b><b>75 000 ₽<small>к оплате</small></b></div><div className="client-screen__body"><section><div><strong>Остатки по городам</strong><a>Все остатки →</a></div><article><b>Москва · ФФ Москва</b><span>1 050 шт. · 21 короб</span><i>Доступно 1 024</i></article><article><b>Краснодар · ФФ Краснодар</b><span>234 шт. · 3 короба</span><i>Доступно 226</i></article></section><section><div><strong>Последние FBS-заказы</strong><a>Открыть FBS →</a></div><article><b>Демо-заказ · Москва</b><span>Товар · M</span><i className="is-green">На сборке</i></article><article><b>Демо-заказ · Казань</b><span>Товар · L</span><i className="is-amber">Ожидает сдачи</i></article></section></div></main>
          </div>
          <div className="client-showcase__actions">
            <article><span>01</span><div><h3>Контролировать остатки</h3><p>Товар, размер, ШК, короб, паллетосорт, зона, ячейка и остатки по каждому городу — в одном поиске.</p></div></article>
            <article><span>02</span><div><h3>Создавать и отслеживать заявки</h3><p>Приёмка, перемещения между филиалами, отгрузки, FBS и FBO: статус, документы, состав и история доступны онлайн.</p></div></article>
            <article><span>03</span><div><h3>Видеть FBS без сюрпризов</h3><p>Список заказов, склад WB, время до отгрузки, сборка, наклейки и средняя скорость доставки.</p></div></article>
            <article><span>04</span><div><h3>Работать со счетами и отчётами</h3><p>Счета, акты, оплаты, услуги, первичная обработка и выгрузки в Excel/PDF — только по своей компании.</p></div></article>
          </div>
        </div>
      </section>
      <section className="marketing-choice marketing-reveal" id="why-logoff" aria-labelledby="why-logoff-title">
        <div className="marketing-choice__main">
          <div className="marketing-choice__copy">
            <span className="marketing-choice__label">Почему LOGOFF WMS</span>
            <h2 id="why-logoff-title">Система должна работать по логике вашего склада.</h2>
            <p>Мы не продаём шаблон, который придётся ломать под реальную работу фулфилмента. Сначала разбираем цепочку приёмки, хранения, сборки и отгрузки. Затем встраиваем WMS так, чтобы процессы стали управляемыми, а не сложнее.</p>
            <div className="marketing-choice__principle">
              <ShieldCheck size={22} />
              <div><strong>Быстро, но не на коленке.</strong><span>Доработки проверяем в живом процессе и сохраняем логику склада.</span></div>
            </div>
          </div>
          <div className="marketing-choice__scheme" aria-label="Схема внедрения WMS на сервер клиента">
            <div className="marketing-choice__scheme-head"><Server size={18} /><span>Ваш контур работы</span></div>
            <div className="marketing-choice__scheme-line" />
            <div className="marketing-choice__scheme-flow">
              <div><small>01</small><b>Ваш VPS</b><span>Сервер и данные остаются у вас</span></div>
              <div><small>02</small><b>LOGOFF WMS</b><span>Настраиваем роли, города и процессы</span></div>
              <div><small>03</small><b>Команда склада</b><span>Работает в вебе и на ТСД</span></div>
            </div>
            <p>Без искусственных ограничений по модулям и рабочим сценариям.</p>
          </div>
        </div>

        <div className="marketing-choice__reasons" role="list" aria-label="Причины выбрать LOGOFF WMS">
          <article role="listitem"><b>Доступно по цене</b><span>Платите за нужную систему, а не за лишние лицензии и функции.</span></article>
          <article role="listitem"><b>Индивидуально</b><span>Подстраиваем логику под ваш фулфилмент, клиентов и команды.</span></article>
          <article role="listitem"><b>Ваш VPS</b><span>Разворачиваем WMS на вашем сервере. Контур и данные под вашим контролем.</span></article>
          <article role="listitem"><b>Поддержка при внедрении</b><span>Помогаем запустить процессы и остаёмся на связи после старта.</span></article>
          <article role="listitem"><b>Модули под ваш процесс</b><span>Быстро дорабатываем нужные инструменты без разрушения действующей логистики.</span></article>
        </div>

        <div className="marketing-choice__contact">
          <div>
            <MessageCircle size={23} />
            <p>Расскажите, как сейчас работает ваш склад</p>
            <h3>Напишите, мы ответим.</h3>
            <span>Обсудим внедрение, перенос процессов или точечную доработку WMS.</span>
          </div>
          <a href="tel:+79267250205" aria-label="Связаться с LOGOFF по номеру +7 926 725-02-05">
            <Phone size={19} />
            <strong>+7 926 725-02-05</strong>
            <small>Все мессенджеры</small>
          </a>
        </div>
      </section>
    </main>
  );
}

function Metric({ icon, value, label, color }: { icon: ReactNode; value: string; label: string; color: string }) { return <article className={`hero-metric hero-metric--${color}`}><span>{icon}</span><b>{value}</b><small>{label}</small></article>; }
function QueueRow({ icon, title, note, value, danger }: { icon: ReactNode; title: string; note: string; value: string; danger?: boolean }) { return <div className="hero-queue__row"><span className={danger ? 'is-danger' : ''}>{icon}</span><div><b>{title}</b><small>{note}</small></div><strong className={danger ? 'is-danger' : ''}>{value}</strong></div>; }
function BranchMini({ city, data, progress }: { city: string; data: string; progress: string }) { return <div className="hero-branches__item"><div><b>{city} · ФФ {city}</b><span>Активен</span></div><small>{data}</small><i><em style={{ width: `${progress}%` }} /></i></div>; }
function Pain({ title, text }: { title: string; text: string }) { return <article><span>×</span><h3>{title}</h3><p>{text}</p></article>; }
function Feature({ icon, tag, title, text }: { icon: ReactNode; tag: string; title: string; text: string }) { return <article className="marketing-feature"><span className="marketing-feature__icon">{icon}</span><small>{tag}</small><h3>{title}</h3><p>{text}</p><span className="marketing-feature__arrow"><ArrowRight size={17} /></span></article>; }
function Location({ city, place, zone, quantity }: { city: string; place: string; zone: string; quantity: string }) { return <div className="warehouse-location"><span>{city}</span><div><b>{place}</b><small>{zone}</small></div><strong>{quantity}</strong></div>; }
function Process({ number, title, text, icon }: { number: string; title: string; text: string; icon: ReactNode }) { return <article><span className="process-steps__number">{number}</span><span className="process-steps__icon">{icon}</span><h3>{title}</h3><p>{text}</p></article>; }
function ThemePreview({ name, caption, tone, active }: { name: string; caption: string; tone: string; active?: boolean }) { return <article className={`theme-preview theme-preview--${tone}${active ? ' is-active' : ''}`}><div className="theme-preview__screen"><aside><i /><i /><i /><i /></aside><main><span /><b>Сегодня</b><em /><div><i /><i /><i /></div></main></div><div><strong>{name}</strong><small>{caption}</small>{active ? <span>Выбрано</span> : null}</div></article>; }
