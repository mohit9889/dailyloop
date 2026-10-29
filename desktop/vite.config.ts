import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],server:{watch:{usePolling:true},proxy:{'/api':'http://127.0.0.1:4000','/v1':'http://127.0.0.1:4000','/auth':'http://127.0.0.1:4000'}}});
