"""Exporta la cuenta elegida sin cambiar ni borrar datos del servidor anterior."""
import argparse
import getpass
import json
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPCookieProcessor

parser = argparse.ArgumentParser()
parser.add_argument('--url', required=True)
parser.add_argument('--output', default='exports/planifia-anterior.json')
args = parser.parse_args()
url = args.url.rstrip('/')
parsed = urlsplit(url)
if parsed.scheme not in ('https', 'http') or parsed.username or parsed.password or (parsed.scheme == 'http' and parsed.hostname not in ('localhost', '127.0.0.1')):
    raise SystemExit('Usa HTTPS o un servidor local, sin credenciales en la dirección.')
output = Path(args.output)
if output.exists():
    raise SystemExit('El archivo ya existe. Elige otra salida para conservar ese respaldo.')
client = build_opener(HTTPCookieProcessor(CookieJar()))

def call(path, data=None):
    request = Request(url + '/api' + path, data=json.dumps(data).encode() if data is not None else None,
                      headers={'Content-Type': 'application/json', 'X-Planifia-Request': '1'})
    with client.open(request, timeout=30) as response:
        return json.load(response)

email = input('Correo de tu cuenta anterior: ').strip()
password = getpass.getpass('Contraseña (no se guardará): ')
try:
    user = call('/auth/login', {'correo': email, 'password': password})
    password = None
    tasks = call('/tareas')
    exams = call('/evaluaciones')
    plans = [call('/planes/' + str(plan['id'])) for plan in call('/planes')]
    data = {'version': 1, 'sourceId': url + ':user:' + str(user['id']),
            'owner': {'id': user['id'], 'nombre': user['nombre'], 'correo': user['correo']},
            'tareas': tasks, 'evaluaciones': exams, 'disponibilidad': call('/disponibilidad'),
            'planes': plans, 'mascota': call('/mascota')}
    output.parent.mkdir(parents=True, exist_ok=True)
    # x impide reemplazar el original si apareció durante la exportación.
    with output.open('x', encoding='utf-8') as file:
        json.dump(data, file, ensure_ascii=False, indent=2, default=str)
    print(f'Exportación conservada en {output}: {len(tasks)} tareas y {len(exams)} evaluaciones. Revisa el archivo y confirma el destino en la nueva aplicación.')
finally:
    password = None
    # La sesión creada para esta exportación queda revocada al terminar.
    try:
        client.open(Request(url + '/api/auth/logout', data=b'{}', headers={'Content-Type': 'application/json', 'X-Planifia-Request': '1'}), timeout=10).close()
    except Exception:
        pass
