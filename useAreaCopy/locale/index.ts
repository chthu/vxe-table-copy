import { type App } from 'vue';
import { createI18n } from 'vue-i18n';
import en_WW from './en_WW';
import zh_CN from './zh_CN';
import fr_FR from './fr_FR';
// 创建 i18n 实例
const i18n = createI18n({
  fallbackLocale: 'zh_CN',
  locale: 'zh_CN',
  missingWarn: false,
  fallbackWarn: false,
  legacy: false,
  messages: {
    en_WW,
    zh_CN,
    fr: fr_FR,
  },
});
export function init(app: App) {
  if (!app.config.globalProperties.$i18n) {
    app.use(i18n);
  }
}
