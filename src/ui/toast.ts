/** Aviso efímero arriba de la pantalla. */

export type Notify = (message: string, durationMs?: number) => void;

export const createToast = (element: HTMLElement): Notify => {
  let timer = 0;
  return (message, durationMs = 2600) => {
    element.textContent = message;
    element.classList.add('is-visible');
    window.clearTimeout(timer);
    timer = window.setTimeout(() => element.classList.remove('is-visible'), durationMs);
  };
};
