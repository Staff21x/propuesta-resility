"""
Resility B2B Email Personalizer
Scraping web + noticias + Claude API → Excel con correos ultra-personalizados
"""

import os
import re
import time
import requests
from bs4 import BeautifulSoup
from datetime import datetime
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
import anthropic

# ─────────────────────────────────────────────
#  CONTACTOS B2B  (10 prospectos Chile/LATAM)
# ─────────────────────────────────────────────
CONTACTS = [
    {
        "nombre": "Carlos Muñoz",
        "cargo": "CTO",
        "empresa": "Banco Internacional",
        "rubro": "Banca / Finanzas",
        "email": "carlos.munoz@bancointernacional.cl",
        "telefono": "+56 2 2345 6789",
    },
    {
        "nombre": "Daniela Ríos",
        "cargo": "Gerente de TI",
        "empresa": "Clinica Las Condes",
        "rubro": "Salud / Healthcare",
        "email": "drios@clinicalascondes.cl",
        "telefono": "+56 2 2210 4000",
    },
    {
        "nombre": "Andrés Morales",
        "cargo": "CISO",
        "empresa": "Falabella Retail",
        "rubro": "Retail / E-commerce",
        "email": "andres.morales@falabella.cl",
        "telefono": "+56 2 2380 9000",
    },
    {
        "nombre": "Valentina Torres",
        "cargo": "Directora de Seguridad",
        "empresa": "Entel Chile",
        "rubro": "Telecomunicaciones",
        "email": "vtorres@entel.cl",
        "telefono": "+56 2 2360 3000",
    },
    {
        "nombre": "Rodrigo Saavedra",
        "cargo": "VP Tecnología",
        "empresa": "AFP Habitat",
        "rubro": "Gestión de Fondos / AFP",
        "email": "rodrigo.saavedra@habitat.cl",
        "telefono": "+56 2 2350 7000",
    },
    {
        "nombre": "Paola Vega",
        "cargo": "Gerente de Ciberseguridad",
        "empresa": "Codelco",
        "rubro": "Minería",
        "email": "pvega@codelco.cl",
        "telefono": "+56 2 2690 3000",
    },
    {
        "nombre": "Felipe Contreras",
        "cargo": "Director de IT",
        "empresa": "Latam Airlines",
        "rubro": "Aviación / Transporte",
        "email": "fcontreras@latam.com",
        "telefono": "+56 2 2565 1234",
    },
    {
        "nombre": "Marcela Fuentes",
        "cargo": "Gerente TI",
        "empresa": "Colbun",
        "rubro": "Energía / Generación Eléctrica",
        "email": "mfuentes@colbun.cl",
        "telefono": "+56 2 2460 5000",
    },
    {
        "nombre": "Sebastián Herrera",
        "cargo": "Chief Information Officer",
        "empresa": "Isapre Consalud",
        "rubro": "Seguros de Salud / Isapre",
        "email": "sherrera@consalud.cl",
        "telefono": "+56 2 2640 9000",
    },
    {
        "nombre": "Carolina Pérez",
        "cargo": "Subgerente de Riesgo Digital",
        "empresa": "Banco BCI",
        "rubro": "Banca / Finanzas",
        "email": "carolina.perez@bci.cl",
        "telefono": "+56 2 2692 5000",
    },
]

# ─────────────────────────────────────────────
#  CONTEXTO RESILITY
# ─────────────────────────────────────────────
RESILITY_CONTEXT = """
Resility es un CyberSOC (Centro de Operaciones de Ciberseguridad) con Inteligencia Artificial,
con base en Chile, que ofrece:

SERVICIOS PRINCIPALES:
- Monitoreo 24/7 de amenazas cibernéticas con IA
- Detección y respuesta a incidentes (MDR - Managed Detection & Response)
- Threat Intelligence en tiempo real
- Gestión de vulnerabilidades
- Cumplimiento regulatorio (CMF, ISO 27001, NIST)
- SIEM gestionado con correlación inteligente de eventos
- Red Team y ejercicios de simulación de ataques

DIFERENCIADORES:
- IA propia entrenada en el panorama de amenazas latinoamericano
- Tiempo de respuesta < 15 minutos ante incidentes críticos
- Equipo de analistas certificados CISSP, CEH, OSCP
- Integración nativa con infraestructura cloud (AWS, Azure, GCP)
- Cumplimiento con regulaciones chilenas y LATAM
- Reducción del 70% en tiempo de detección vs SOC tradicional

CLIENTES OBJETIVO: Empresas medianas y grandes en sectores regulados: banca, salud, energía,
retail, telco, minería, AFP/seguros.

PROPUESTA DE VALOR: "Protege tu negocio con inteligencia artificial mientras tu equipo de IT
se enfoca en innovar — nosotros vigilamos 24/7."
"""

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
}


# ─────────────────────────────────────────────
#  HELPERS
# ─────────────────────────────────────────────

def extract_domain(email: str) -> str:
    return email.split("@")[1]


def scrape_website(domain: str) -> str:
    """Intenta scrapear la web y devuelve texto relevante (máx ~2000 chars)."""
    urls_to_try = [f"https://www.{domain}", f"https://{domain}"]
    for url in urls_to_try:
        try:
            resp = requests.get(url, headers=HEADERS, timeout=10, allow_redirects=True)
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, "lxml")
                # Eliminar scripts/styles
                for tag in soup(["script", "style", "nav", "footer", "header"]):
                    tag.decompose()
                # Extraer texto
                text = soup.get_text(separator=" ", strip=True)
                text = re.sub(r"\s+", " ", text)
                return url, text[:2500]
        except Exception:
            continue
    return f"https://www.{domain}", ""


def search_news(empresa: str, rubro: str) -> str:
    """Busca noticias recientes usando DuckDuckGo HTML (sin API key)."""
    query = f"{empresa} ciberseguridad OR ciberataque OR hackeo OR transformación digital 2025 2026"
    url = f"https://html.duckduckgo.com/html/?q={requests.utils.quote(query)}"
    snippets = []
    try:
        resp = requests.get(url, headers=HEADERS, timeout=12)
        soup = BeautifulSoup(resp.text, "lxml")
        results = soup.select(".result__snippet")[:5]
        for r in results:
            snippets.append(r.get_text(strip=True))
    except Exception:
        pass

    if not snippets:
        # Búsqueda genérica del rubro
        query2 = f"ciberseguridad {rubro} Chile 2025 amenazas"
        url2 = f"https://html.duckduckgo.com/html/?q={requests.utils.quote(query2)}"
        try:
            resp2 = requests.get(url2, headers=HEADERS, timeout=12)
            soup2 = BeautifulSoup(resp2.text, "lxml")
            results2 = soup2.select(".result__snippet")[:4]
            for r in results2:
                snippets.append(r.get_text(strip=True))
        except Exception:
            pass

    return " | ".join(snippets) if snippets else "Sin noticias específicas encontradas."


def generate_email(contact: dict, web_url: str, web_content: str, news: str, client: anthropic.Anthropic) -> tuple[str, str]:
    """Llama a Claude para redactar asunto + cuerpo del correo personalizado."""

    prompt = f"""Eres el Director Comercial de Resility, un CyberSOC con IA de Chile.
Debes redactar un correo de ventas ULTRA personalizado para el siguiente prospecto.

═══ INFORMACIÓN DEL PROSPECTO ═══
Nombre: {contact['nombre']}
Cargo: {contact['cargo']}
Empresa: {contact['empresa']}
Rubro: {contact['rubro']}
Email: {contact['email']}

═══ SITIO WEB DE LA EMPRESA ═══
URL: {web_url}
Contenido relevante:
{web_content[:1500] if web_content else "No se pudo obtener contenido del sitio web."}

═══ NOTICIAS / CONTEXTO RECIENTE ═══
{news[:1200]}

═══ SOBRE RESILITY ═══
{RESILITY_CONTEXT}

═══ INSTRUCCIONES ═══
1. Escribe un correo profesional en español, tono cálido pero ejecutivo
2. PRIMERA LÍNEA: referencia algo ESPECÍFICO de la empresa/rubro/noticias para demostrar que investigaste
3. Conecta el dolor/necesidad específica del rubro con lo que ofrece Resility
4. Menciona 2-3 beneficios concretos y relevantes para SU industria
5. CTA claro: proponer una llamada de 20 minutos
6. Extensión: 180-250 palabras (ni demasiado corto ni largo)
7. Firma: usa "Equipo Comercial, Resility | CyberSOC con IA"

Devuelve EXACTAMENTE este formato (sin texto adicional):
ASUNTO: [asunto del email aquí]
---
[cuerpo del correo aquí]"""

    message = client.messages.create(
        model="claude-opus-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = message.content[0].text.strip()

    # Parsear asunto y cuerpo
    if "---" in raw:
        parts = raw.split("---", 1)
        asunto_line = parts[0].strip()
        cuerpo = parts[1].strip()
        asunto = asunto_line.replace("ASUNTO:", "").strip()
    else:
        lines = raw.split("\n")
        asunto = lines[0].replace("ASUNTO:", "").strip()
        cuerpo = "\n".join(lines[1:]).strip()

    return asunto, cuerpo


def build_excel(results: list, output_path: str):
    """Genera un Excel bien formateado con todos los resultados."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Correos Personalizados Resility"

    # Estilos
    header_fill = PatternFill("solid", fgColor="0A1628")   # Azul oscuro Resility
    accent_fill = PatternFill("solid", fgColor="1A56DB")   # Azul
    alt_fill    = PatternFill("solid", fgColor="EEF2FF")   # Azul muy claro
    header_font = Font(name="Calibri", bold=True, color="FFFFFF", size=11)
    title_font  = Font(name="Calibri", bold=True, color="FFFFFF", size=13)
    normal_font = Font(name="Calibri", size=10)
    wrap_align  = Alignment(wrap_text=True, vertical="top")
    center      = Alignment(horizontal="center", vertical="center")
    thin_border = Border(
        left=Side(style="thin", color="D1D5DB"),
        right=Side(style="thin", color="D1D5DB"),
        top=Side(style="thin", color="D1D5DB"),
        bottom=Side(style="thin", color="D1D5DB"),
    )

    # Título
    ws.merge_cells("A1:K1")
    ws["A1"] = f"RESILITY — Correos de Ventas Personalizados  |  Generado: {datetime.now().strftime('%d/%m/%Y %H:%M')}"
    ws["A1"].font = title_font
    ws["A1"].fill = header_fill
    ws["A1"].alignment = center

    # Cabeceras
    columns = ["#", "Nombre", "Cargo", "Empresa", "Rubro", "Email", "Teléfono", "Web Encontrada", "Asunto", "Correo Personalizado", "Estado"]
    widths   = [4,    18,      18,      22,         22,      28,      16,          30,               40,       70,                      12]

    for col_idx, (col_name, width) in enumerate(zip(columns, widths), start=1):
        cell = ws.cell(row=2, column=col_idx, value=col_name)
        cell.font = header_font
        cell.fill = accent_fill
        cell.alignment = center
        cell.border = thin_border
        ws.column_dimensions[openpyxl.utils.get_column_letter(col_idx)].width = width

    ws.row_dimensions[1].height = 28
    ws.row_dimensions[2].height = 22

    # Datos
    for i, row in enumerate(results, start=1):
        r = i + 2
        fill = alt_fill if i % 2 == 0 else PatternFill("solid", fgColor="FFFFFF")
        values = [
            i,
            row.get("nombre", ""),
            row.get("cargo", ""),
            row.get("empresa", ""),
            row.get("rubro", ""),
            row.get("email", ""),
            row.get("telefono", ""),
            row.get("web_url", ""),
            row.get("asunto", ""),
            row.get("correo", ""),
            row.get("estado", "OK"),
        ]
        for col_idx, val in enumerate(values, start=1):
            cell = ws.cell(row=r, column=col_idx, value=val)
            cell.font = normal_font
            cell.fill = fill
            cell.border = thin_border
            if col_idx in (10,):   # Correo personalizado
                cell.alignment = wrap_align
                ws.row_dimensions[r].height = 120
            elif col_idx in (9,):  # Asunto
                cell.alignment = Alignment(vertical="center", wrap_text=True)
            else:
                cell.alignment = Alignment(vertical="center")

    # Freeze header
    ws.freeze_panes = "A3"

    wb.save(output_path)
    print(f"\n✅  Excel guardado en: {output_path}")


# ─────────────────────────────────────────────
#  MAIN
# ─────────────────────────────────────────────

def main():
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise SystemExit(
            "❌  Variable de entorno ANTHROPIC_API_KEY no encontrada.\n"
            "    Ejecuta:  export ANTHROPIC_API_KEY='sk-ant-...'"
        )

    client = anthropic.Anthropic(api_key=api_key)

    print("=" * 65)
    print("  RESILITY — Personalizador de Correos B2B con IA")
    print(f"  {len(CONTACTS)} contactos  |  {datetime.now().strftime('%d/%m/%Y %H:%M')}")
    print("=" * 65)

    results = []

    for idx, contact in enumerate(CONTACTS, start=1):
        print(f"\n[{idx:02d}/{len(CONTACTS)}] {contact['nombre']} — {contact['empresa']}")
        print(f"         Cargo: {contact['cargo']}  |  Rubro: {contact['rubro']}")

        domain = extract_domain(contact["email"])
        print(f"  🌐  Scrapeando {domain}...", end="", flush=True)
        web_url, web_content = scrape_website(domain)
        chars = len(web_content)
        print(f" {chars} chars obtenidos")

        print(f"  📰  Buscando noticias...", end="", flush=True)
        news = search_news(contact["empresa"], contact["rubro"])
        snippets = news.count("|") + 1 if news and news != "Sin noticias específicas encontradas." else 0
        print(f" {snippets} snippets encontrados")

        print(f"  🤖  Generando correo con Claude...", end="", flush=True)
        try:
            asunto, correo = generate_email(contact, web_url, web_content, news, client)
            estado = "OK"
            print(" ✓")
        except Exception as e:
            asunto = "Error al generar"
            correo = f"Error: {e}"
            estado = "ERROR"
            print(f" ✗ {e}")

        print(f"\n  📧  ASUNTO: {asunto}")
        preview = correo[:120].replace("\n", " ")
        print(f"  ✉️   PREVIEW: {preview}...")

        results.append({
            **contact,
            "web_url": web_url,
            "asunto": asunto,
            "correo": correo,
            "estado": estado,
        })

        # Pausa para respetar rate limits
        if idx < len(CONTACTS):
            time.sleep(2)

    # Generar Excel
    output_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resility_correos_b2b.xlsx")
    build_excel(results, output_path)

    print("\n" + "=" * 65)
    print(f"  PROCESO COMPLETADO  —  {len(results)} correos generados")
    print(f"  Archivo: resility_correos_b2b.xlsx")
    print("=" * 65)


if __name__ == "__main__":
    main()
