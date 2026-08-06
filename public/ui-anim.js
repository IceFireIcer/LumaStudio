/* ============ Luma Studio — GSAP UI 动画层 ============
 * 依赖 public/vendor/gsap/gsap.min.js（缺失时静默降级为原有 CSS 过渡）。
 * 遵循 GSAP 官方实践：只动画 transform / opacity（autoAlpha），
 * 支持 prefers-reduced-motion，减少动效偏好下自动降级。
 */
(function () {
  if (typeof gsap === 'undefined') return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const D = reduce ? 0 : 0.45;
  const EASE = 'power2.out';

  document.documentElement.classList.add('ui-anim');

  const UIAnim = {
    reduce,

    /* 网格卡片入场：批量 stagger，避免逐个创建 tween */
    gridIn(cards) {
      if (!cards || !cards.length) return;
      if (reduce) { gsap.set(cards, { clearProps: 'all' }); return; }
      gsap.from(cards, {
        y: 22,
        autoAlpha: 0,
        duration: D,
        ease: EASE,
        stagger: { each: 0.04, from: 'start' },
        overwrite: 'auto',
      });
    },

    /* 灯箱开合：遮罩淡入淡出 + 图片弹性缩放 */
    lightbox(el, img, open) {
      gsap.killTweensOf(el);
      if (img) gsap.killTweensOf(img);
      if (reduce) { el.classList.toggle('open', open); return; }
      if (open) {
        el.classList.add('open');
        gsap.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.24, ease: 'power1.out', overwrite: 'auto' });
        if (img) gsap.fromTo(img, { scale: 0.88 }, { scale: 1, duration: 0.32, ease: 'back.out(1.5)', overwrite: 'auto' });
      } else {
        gsap.to(el, {
          autoAlpha: 0,
          duration: 0.16,
          ease: 'power1.in',
          overwrite: 'auto',
          onComplete() { el.classList.remove('open'); },
        });
        if (img) gsap.to(img, { scale: 0.94, duration: 0.16, overwrite: 'auto' });
      }
    },

    /* 图片切换：淡出 -> 换源 -> 淡入（灯箱导航 / 幻灯片） */
    crossfade(img, src, onDone) {
      if (reduce) { img.src = src; if (onDone) onDone(); return; }
      gsap.killTweensOf(img);
      gsap.to(img, {
        autoAlpha: 0,
        duration: 0.1,
        overwrite: 'auto',
        onComplete() {
          img.src = src;
          gsap.to(img, { autoAlpha: 1, duration: 0.26, ease: EASE, overwrite: 'auto' });
          if (onDone) onDone();
        },
      });
    },

    /* Toast：滑入 + 停留 + 滑出 */
    toast(el, msg, isErr) {
      el.textContent = msg;
      el.classList.toggle('err', !!isErr);
      if (reduce) {
        el.classList.add('show');
        clearTimeout(el._t);
        el._t = setTimeout(() => el.classList.remove('show'), 2400);
        return;
      }
      gsap.killTweensOf(el);
      gsap.set(el, { y: 16, autoAlpha: 0 });
      el.classList.add('show');
      gsap.timeline({ onComplete() { el.classList.remove('show'); } })
        .to(el, { y: 0, autoAlpha: 1, duration: 0.3, ease: 'back.out(1.7)' })
        .to({}, { duration: 2.0 })
        .to(el, { y: 10, autoAlpha: 0, duration: 0.28, ease: 'power1.in' });
    },

    /* 通用模态框：遮罩淡入 + 内容弹性缩放 */
    modal(el, content, open) {
      gsap.killTweensOf(el);
      if (content) gsap.killTweensOf(content);
      if (reduce) { el.hidden = !open; return; }
      if (open) {
        el.hidden = false;
        gsap.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power1.out', overwrite: 'auto' });
        if (content) gsap.fromTo(
          content,
          { scale: 0.94, y: 10 },
          { scale: 1, y: 0, duration: 0.28, ease: 'back.out(1.6)', overwrite: 'auto' }
        );
      } else {
        gsap.to(el, {
          autoAlpha: 0,
          duration: 0.14,
          ease: 'power1.in',
          overwrite: 'auto',
          onComplete() {
            el.hidden = true;
            gsap.set(el, { clearProps: 'opacity,visibility' });
          },
        });
      }
    },
  };

  window.UIAnim = UIAnim;
})();
