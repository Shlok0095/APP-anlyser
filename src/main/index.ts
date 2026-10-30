import { app } from 'electron'
import { registerAppLifecycle } from './app/lifecycle'

app.setName('Universal Application Analyzer')
registerAppLifecycle()
