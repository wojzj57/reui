/**
 * classNames —— 条件类名工具（RFC-004 §3.7.5）。
 *
 * 类似 clsx，但更轻量。
 *
 * @example
 * classNames('foo', { bar: true, baz: false }, 'qux'); // => 'foo bar qux'
 */
export function classNames(...args: Array<string | Record<string, boolean> | null | undefined>): string {
  const classes: string[] = [];

  for (const arg of args) {
    if (!arg) continue;

    if (typeof arg === 'string') {
      classes.push(arg);
    } else if (typeof arg === 'object') {
      for (const key of Object.keys(arg)) {
        if (arg[key]) {
          classes.push(key);
        }
      }
    }
  }

  return classes.join(' ');
}
