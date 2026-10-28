export type InstallPlatform = 'ios' | 'android' | 'desktop';
export type InstallState = {
  installed: boolean;
  available: boolean;
  prompting: boolean;
  outcome: 'idle' | 'accepted' | 'dismissed' | 'unavailable';
};
export const INITIAL_INSTALL_STATE: InstallState = { installed: false, available: false, prompting: false, outcome: 'idle' };

type InstallNavigator = { userAgent: string; platform: string; maxTouchPoints: number; standalone?: boolean };
type InstallWindow = EventTarget & { navigator: InstallNavigator; isSecureContext: boolean; matchMedia(query: string): MediaQueryList };
type InstallPrompt = Event & { prompt(): Promise<{ outcome: 'accepted' | 'dismissed' } | void>; userChoice?: Promise<{ outcome: 'accepted' | 'dismissed' }> };

// This is only a local hint for which instructions to show, never an installability check.
export function suggestedInstallPlatform(nav: InstallNavigator): InstallPlatform {
  if (/iPad|iPhone|iPod/i.test(nav.userAgent) || (/Mac/i.test(nav.platform) && nav.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(nav.userAgent)) return 'android';
  return 'desktop';
}

export function createInstallController(target: InstallWindow, onChange: (state: InstallState) => void) {
  const media = target.matchMedia('(display-mode: standalone)');
  let active = true;
  let observedInstall = false;
  let prompt: InstallPrompt | null = null;
  let state: InstallState = { ...INITIAL_INSTALL_STATE, installed: media.matches || target.navigator.standalone === true };
  const publish = (update: Partial<InstallState>) => { state = { ...state, ...update }; if (active) onChange({ ...state }); };
  const onPrompt = (event: Event) => {
    if (!active || !target.isSecureContext || state.installed || state.prompting || typeof (event as InstallPrompt).prompt !== 'function') return;
    event.preventDefault();
    prompt = event as InstallPrompt;
    publish({ available: true, outcome: 'idle' });
  };
  const onInstalled = () => { observedInstall = true; prompt = null; publish({ installed: true, available: false, outcome: 'idle' }); };
  const onDisplay = () => {
    const installed = observedInstall || media.matches || target.navigator.standalone === true;
    if (installed) prompt = null;
    publish({ installed, available: installed ? false : Boolean(prompt) });
  };
  target.addEventListener('beforeinstallprompt', onPrompt);
  target.addEventListener('appinstalled', onInstalled);
  media.addEventListener('change', onDisplay);
  return {
    getSnapshot: () => ({ ...state }),
    async install() {
      if (!active || state.prompting || state.installed) return;
      const event = prompt;
      if (!event) { publish({ outcome: 'unavailable' }); return; }
      // A browser prompt is single-use. Claim it before awaiting to block double taps.
      prompt = null;
      publish({ available: false, prompting: true, outcome: 'idle' });
      try {
        // Keep this call in the user's click task; do not await other work first.
        const result = await event.prompt();
        const choice = result || await event.userChoice;
        const outcome = choice?.outcome === 'accepted' || choice?.outcome === 'dismissed' ? choice.outcome : 'unavailable';
        // Accepting a prompt is not proof that installation finished.
        publish({ outcome: state.installed ? 'idle' : outcome });
      } catch { publish({ outcome: 'unavailable' }); }
      finally { publish({ prompting: false }); }
    },
    destroy() {
      active = false; prompt = null;
      target.removeEventListener('beforeinstallprompt', onPrompt);
      target.removeEventListener('appinstalled', onInstalled);
      media.removeEventListener('change', onDisplay);
    },
  };
}
