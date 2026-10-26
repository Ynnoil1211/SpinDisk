/**
 * Aviso persistente con acción.
 *
 * Sirve para lo único que la app no puede resolver sola: en la tablet, el
 * permiso de acceso a las notificaciones. Un toast se va a los segundos y no se
 * puede tocar; esto se queda hasta que el usuario decide, y lleva un botón que
 * abre los ajustes del sistema.
 */

export interface BannerHandlers {
  onAction: () => void;
}

export class Banner {
  isVisible = false;

  private readonly root: HTMLElement;
  private readonly text: HTMLElement;
  private readonly action: HTMLButtonElement;
  private readonly handlers: BannerHandlers;

  constructor(root: HTMLElement, handlers: BannerHandlers) {
    this.root = root;
    this.handlers = handlers;

    const text = root.querySelector('[data-banner-text]');
    const action = root.querySelector('[data-banner-action]');
    if (!text || !action) throw new Error('El aviso necesita texto y acción');

    this.text = text as HTMLElement;
    this.action = action as HTMLButtonElement;

    this.action.addEventListener('click', () => {
      this.hide();
      this.handlers.onAction();
    });
  }

  show(message: string): void {
    this.text.textContent = message;
    this.root.classList.add('is-visible');
    this.root.hidden = false;
    this.root.removeAttribute('hidden');
    this.isVisible = true;
  }

  hide(): void {
    this.root.classList.remove('is-visible');
    this.root.hidden = true;
    this.root.setAttribute('hidden', '');
    this.isVisible = false;
  }
}
