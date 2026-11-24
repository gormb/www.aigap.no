import http.server, socketserver, os, sys, functools
os.chdir(sys.argv[1]); port = int(sys.argv[2])
h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=sys.argv[1])
socketserver.TCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(("127.0.0.1", port), h) as s:
    print("serving", sys.argv[1], "on", port, flush=True); s.serve_forever()
