// Local source application for exercising the same DOM relay as real ChatGPT.
export function createDemoLab(messageId: string) {
  if (!document.getElementById('demo-native-lab-style')) {
    const style = document.createElement('style'); style.id = 'demo-native-lab-style';
    style.textContent = `.demo-native-lab{font:13px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;background:#fafafa;color:#202020;border:1px solid #ddd;border-radius:12px;padding:20px;box-sizing:border-box}.demo-native-lab *{box-sizing:border-box}.demo-native-lab h2{font-size:20px;margin:3px 0 6px}.demo-native-lab p{color:#666;margin:0 0 18px}.demo-native-lab .lab-tag{font-size:10px;color:#666;letter-spacing:1px}.demo-native-lab .lab-controls{display:flex;flex-wrap:wrap;gap:16px;align-items:center;margin-bottom:18px}.demo-native-lab label{display:flex;align-items:center;gap:8px}.demo-native-lab select{font:inherit;padding:5px 8px;border:1px solid #ccc;border-radius:6px;background:white;color:#202020}.demo-native-lab input{accent-color:#303030;max-width:110px}.demo-native-lab .lab-grid{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:5px}.demo-native-lab button{font:inherit;color:#555;background:white;border:1px solid #ddd;border-radius:6px;padding:7px 2px;cursor:pointer}.demo-native-lab button[aria-pressed=true]{background:#242424;color:white;border-color:#242424}.demo-native-lab .lab-result{display:flex;justify-content:space-between;gap:8px;align-items:center;border-top:1px solid #ddd;padding-top:14px;margin-top:16px}.demo-native-lab output{font-size:12px;color:#444}.demo-native-lab .lab-reset{padding:5px 12px}`;
    document.head.append(style);
  }
  const source = document.createElement('div'); source.dataset.dilSourceMessageId = messageId;
  source.className = 'demo-native-lab'; source.innerHTML = '<span class="lab-tag">本地原生交互模拟</span><h2>GPU 布局实验室</h2><p>切换布局或选择线程，观察原生控件的状态。</p><div class="lab-controls"><label>布局<select aria-label="布局"><option value="row">行优先</option><option value="column">列优先</option></select></label><label>线程<input type="range" aria-label="线程" min="0" max="31" value="0"></label></div><div class="lab-grid"></div><div class="lab-result"><output aria-live="polite"></output><button class="lab-reset">重置</button></div>';
  const grid = source.querySelector('.lab-grid')!;
  const select = source.querySelector('select')!; const range = source.querySelector('input')!;
  function update() {
    const selected = Number(range.value);
    for (const [index, button] of [...grid.querySelectorAll('button')].entries()) {
      const number = select.value === 'row' ? index : index % 8 * 4 + Math.floor(index / 8);
      button.textContent = `T${String(number).padStart(2, '0')}`; button.setAttribute('aria-pressed', String(number === selected)); button.dataset.thread = String(number);
    }
    source.querySelector('output')!.textContent = `${select.value === 'row' ? '行优先' : '列优先'} · 当前线程 T${String(selected).padStart(2, '0')}`;
  }
  for (let i = 0; i < 32; i++) { const button = document.createElement('button'); button.addEventListener('click', () => { range.value = button.dataset.thread!; update(); }); grid.append(button); }
  select.addEventListener('change', update); range.addEventListener('input', update);
  source.querySelector('.lab-reset')!.addEventListener('click', () => { select.value = 'row'; range.value = '0'; update(); });
  update();
  const holder = document.createElement('div'); holder.hidden = true; holder.dataset.latticeDemoSource = ''; holder.append(source); document.body.append(holder);
  return source;
}
