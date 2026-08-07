/* ============ Luma Studio — GSAP UI 动画层 ============
 * 依赖 public/vendor/gsap/gsap.min.js（缺失时静默降级为原有 CSS 过渡）。
 * 遵循 GSAP 官方实践：只动画 transform / opacity（autoAlpha），不动画布局属性。
 * 动效 token 集中定义（v1.2 §1.5）：
 *   - hover/状态切换 0.18s power2.out
 *   - 单元素入场 0.28s power2.out / back.out(1.6)
 *   - 模态/遮罩 0.2-0.28s power1.out + back.out(1.6)
 *   - 网格 Flip 0.4s power2.inOut
 *   - 页面切换 0.32s power2.out
 *   - 图片交叉过渡 0.1s 出 + 0.26s 入
 *   - stagger 0.04s
 * 减弱动效由 settings.reduceMotion 驱动（system | on | off，默认 system），
 * 不再只在模块加载时一次性读取 matchMedia。
 */
(function () {
  if (typeof gsap === 'undefined') return;
  if (window.Flip) gsap.registerPlugin(Flip);

  /* JS 动效 token（§1.5） */
  const D = { fast: 0.18, base: 0.28, slow: 0.45 };
  const EASE = { out: 'power2.out', spring: 'back.out(1.6)', in: 'power1.in' };
  const STAGGER = 0.04;

  let reduceMode = 'system';

  function systemPrefersReduce() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function isReduced() {
    if (reduceMode === 'on') return true;
    if (reduceMode === 'off') return false;
    return systemPrefersReduce();
  }

  document.documentElement.classList.add('ui-anim');
  // GSAP 接管页面切换后，关闭 CSS viewIn 动画，避免双跑
  document.head.insertAdjacentHTML('beforeend',
    '<style>.ui-anim .view{animation:none!important}</style>');

  const UIAnim = {
    D, EASE, STAGGER,
    get reduce() { return isReduced(); },
    /* 由设置驱动：settings.reduceMotion 变化后调用（system | on | off） */
    setReduceMode(mode) { reduceMode = mode; },
    matchMediaRefresh() { /* 跟随系统时以最新 matchMedia 为准（isReduced 动态读取） */ },

    /* 网格卡片入场：批量 stagger，避免逐个创建 tween */
    gridIn(cards) {
      if (!cards || !cards.length) return;
      if (isReduced()) return;
      gsap.from(cards, {
        y: 22,
        autoAlpha: 0,
        duration: D.base,
        ease: EASE.out,
        stagger: { each: STAGGER, from: 'start' },
        overwrite: 'auto',
        // 逐属性清理：避免与 Flip 的 scale 缓存冲突（"not eligible for reset" 警告）
        clearProps: 'y,opacity,visibility',
      });
    },

    /* 灯箱开合：遮罩淡入淡出 + 图片弹性缩放 */
    lightbox(el, img, open) {
      gsap.killTweensOf(el);
      if (img) gsap.killTweensOf(img);
      if (isReduced()) { el.classList.toggle('open', open); return; }
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

    /* 图片切换：淡出 -> 换源 -> 淡入（幻灯片 / 灯箱保留接口） */
    crossfade(img, src, onDone) {
      if (isReduced()) { img.src = src; if (onDone) onDone(); return; }
      gsap.killTweensOf(img);
      gsap.to(img, {
        autoAlpha: 0,
        duration: D.fast,
        overwrite: 'auto',
        onComplete() {
          img.src = src;
          gsap.to(img, { autoAlpha: 1, duration: 0.26, ease: EASE.out, overwrite: 'auto' });
          if (onDone) onDone();
        },
      });
    },

    /* 灯箱方向化导航（v1.2 §3.2.5）：当前图 x:∓14 淡出 -> 换源 -> 新图 x:±14 归零淡入 */
    navCrossfade(img, src, dir = 1, onDone) {
      if (isReduced()) { img.src = src; if (onDone) onDone(); return; }
      gsap.killTweensOf(img);
      const x = 14 * (dir > 0 ? 1 : -1);
      gsap.to(img, {
        x: -x,
        autoAlpha: 0,
        duration: D.fast,
        ease: EASE.in,
        overwrite: 'auto',
        onComplete() {
          img.src = src;
          gsap.fromTo(img, { x, autoAlpha: 0 }, {
            x: 0, autoAlpha: 1, duration: 0.26, ease: EASE.out, overwrite: 'auto',
            onComplete() { if (onDone) onDone(); },
          });
        },
      });
    },

    /* Toast：滑入 + 停留 + 滑出；opts = { err, action: { label, onClick } } */
    toast(el, msg, opts) {
      const o = (opts && typeof opts === 'object') ? opts : { err: !!opts };
      el.textContent = '';
      const text = document.createElement('span');
      text.textContent = msg;
      el.appendChild(text);
      el.classList.toggle('err', !!o.err);

      let actionBtn = el.querySelector('.toast-action');
      if (o.action && o.action.label) {
        if (!actionBtn) {
          actionBtn = document.createElement('button');
          actionBtn.className = 'toast-action';
          el.appendChild(actionBtn);
        }
        actionBtn.textContent = o.action.label;
        actionBtn.onclick = () => {
          const fn = o.action.onClick;
          UIAnim.toastHide(el);
          if (fn) setTimeout(fn, 0);
        };
      } else if (actionBtn) {
        actionBtn.remove();
      }

      UIAnim.toastShow(el);
    },
    toastShow(el) {
      if (isReduced()) {
        el.classList.add('show');
        clearTimeout(el._t);
        el._t = setTimeout(() => UIAnim.toastHide(el), 2400);
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
    toastHide(el) {
      clearTimeout(el._t);
      gsap.killTweensOf(el);
      if (isReduced()) { el.classList.remove('show'); return; }
      gsap.to(el, {
        y: 10, autoAlpha: 0, duration: 0.18, ease: 'power1.in', overwrite: 'auto',
        onComplete() { el.classList.remove('show'); },
      });
    },

    /* 通用模态框：遮罩淡入 + 内容弹性缩放 */
    modal(el, content, open) {
      gsap.killTweensOf(el);
      if (content) gsap.killTweensOf(content);
      if (isReduced()) { el.hidden = !open; return; }
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

    /* 页面方向过渡（v1.2 §2.4）：旧视图 0.14s 淡出 -> 移除 .active -> 新视图入场
     * fromSidebar：从侧边栏进入的非首层视图从 x:16 进入；返回相册/收藏夹用 y:12。
     * 同一时间只允许一个页面 tween；reduced-motion 下瞬时切换。 */
    switchView(oldEl, newEl, opts = {}) {
      if (!newEl) return;
      const oldActive = oldEl && oldEl !== newEl && oldEl.classList.contains('active');
      if (isReduced() || !oldActive) {
        if (oldEl && oldActive) oldEl.classList.remove('active');
        newEl.classList.add('active');
        return;
      }
      gsap.killTweensOf(oldEl);
      gsap.killTweensOf(newEl);
      const fromSidebar = !!opts.fromSidebar;
      gsap.to(oldEl, {
        autoAlpha: 0,
        duration: D.fast,
        ease: EASE.in,
        overwrite: 'auto',
        onComplete() {
          oldEl.classList.remove('active');
          newEl.classList.add('active');
          gsap.fromTo(
            newEl,
            { autoAlpha: 0, x: fromSidebar ? 16 : 0, y: fromSidebar ? 0 : 12 },
            { autoAlpha: 1, x: 0, y: 0, duration: 0.32, ease: EASE.out, overwrite: 'auto' }
          );
        },
      });
    },

    /* 快捷评分星星 pop：scale 1 -> 1.25 -> 1（v1.2 §3.1.4） */
    starPop(el) {
      if (isReduced()) return;
      gsap.killTweensOf(el);
      gsap.fromTo(el, { scale: 1 }, { scale: 1.25, duration: 0.1, yoyo: true, repeat: 1, ease: 'power2.out' });
    },
  };

  window.UIAnim = UIAnim;
})();
