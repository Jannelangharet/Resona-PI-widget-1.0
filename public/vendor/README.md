# StreamBIM widget API

Vendored upstream distribution and MIT license from https://github.com/streambim/streambim-widget-api at commit `9543e21fd829a8a63934b71b904f873b530b3313`.

The actual SDK implementation takes the remote parent window. This widget therefore calls `connectToParent(window.parent, {})`, despite the README example saying `window`.
