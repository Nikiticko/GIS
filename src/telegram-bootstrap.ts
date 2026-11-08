declare global {
  interface Window {
    Telegram?: { WebApp: { initData: string; ready: () => void; expand: () => void } };
  }
}

const telegramParameters = /(?:[?#&])tgWebApp(?:Data|Version|Platform|ThemeParams)=/;

export const telegramSdkReady: Promise<void> = telegramParameters.test(window.location.href)
  ? new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = "https://telegram.org/js/telegram-web-app.js?64";
      script.onload = () => resolve();
      script.onerror = () => resolve();
      document.head.append(script);
    })
  : Promise.resolve();
