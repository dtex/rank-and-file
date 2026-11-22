// Sign-in providers. To add one, write a file like google.js and list it here;
// it is switched on when <ID>_CLIENT_ID and <ID>_CLIENT_SECRET are set (add the id in config.js).
import google from './google.js'
import github from './github.js'

export const PROVIDERS = { google, github }
