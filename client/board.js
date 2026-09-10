/* Таблица рейтинга — одна разметка на три места: экран условий, кабинет и
 * отдельная страница /top. Вынесено сюда именно поэтому: три копии одного
 * списка однажды разъедутся, и «рейтинг на сайте не такой, как в сторис»
 * станет вопросом в поддержку, а не опечаткой.
 *
 * Модуль ничего не знает ни про язык, ни про сеть: строки и форматирование
 * ему передаёт страница.
 */
window.BOARD = {
  medal(rank) {
    return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🏆';
  },

  /** Ник приходит из анкеты и попадает в разметку — значит, экранируется. */
  esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  },

  /**
   * @param {object} o — { rows, finalized, computedAt, t, num, locale }
   */
  paint(list, empty, upd, o) {
    if (!list) return;

    const rows = o.rows || [];
    // Полоса за строкой считается от лидера: соотношение активаций видно
    // глазом, без чтения цифр.
    const max = Math.max(1, ...rows.map((r) => r.activations));
    if (empty) empty.hidden = rows.length > 0;

    list.innerHTML = rows.map((r) => `
      <li class="${r.isMe ? 'me' : ''}">
        <span class="bg" style="width:${Math.max(4, (r.activations / max) * 100)}%"></span>
        <span class="pos">${r.rank <= 3 ? this.medal(r.rank) : r.rank}</span>
        <span class="name">${r.isMe ? o.t('board.you') : this.esc(r.nick || o.t('board.anon'))}</span>
        <span class="val">${o.num(r.activations)}</span>
      </li>`).join('');

    if (upd) {
      upd.textContent = o.finalized
        ? o.t('board.frozen')
        : o.t('board.updated', {
            time: new Date(o.computedAt).toLocaleTimeString(o.locale, { hour: '2-digit', minute: '2-digit' }),
          });
    }
  },
};
