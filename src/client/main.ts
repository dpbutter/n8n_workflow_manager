import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import './style.css'

import Dashboard from './views/Dashboard.vue'
import InstanceConfig from './views/InstanceConfig.vue'

const routes = [
  { path: '/', component: Dashboard },
  { path: '/instances', component: InstanceConfig },
  { path: '/instances/:id', component: InstanceConfig }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
