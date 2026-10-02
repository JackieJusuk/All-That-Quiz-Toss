import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  appName: 'economy-quiz', // 콘솔에 등록한 appName과 동일 (intoss://economy-quiz)
  brand: {
    primaryColor: '#3D5AFE',
  },
  permissions: [],
  webBundleDir: 'dist',
});
