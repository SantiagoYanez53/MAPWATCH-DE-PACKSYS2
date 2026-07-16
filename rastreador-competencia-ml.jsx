// ---------- Helpers ----------
const STORAGE_CATALOG_KEY = "catalogo-productos";

const norm = (s = "") => s.toString().trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function pickField(row, candidates) {
  const keys = Object.keys(row);
  for (const cand of candidates) {
    const match = keys.find((k) => norm(k) === norm(cand));
    if (match) return row[match];
  }
  for (const cand of candidates) {
    const match = keys.find((k) => norm(k).includes(norm(cand)));
    if (match) return row[match];
  }
  return "";
}

function currency(n) {
  const num = Number(String(n).replace(/[^0-9.-]/g, ""));
  if (Number.isNaN(num)) return n || "-";
  return num.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

function mlSearchUrl(title) {
  const q = encodeURIComponent(title.trim());
  return `https://listado.mercadolibre.com.mx/${q}`;
}

const bookmarkletSource = function () {
  try {
    var titleEl = document.querySelector("h1.ui-pdp-title") || document.querySelector(".ui-pdp-header__title-container h1");
    var title = titleEl ? titleEl.innerText.trim() : document.title;
    var priceEl = document.querySelector(".ui-pdp-price__second-line .andes-money-amount__fraction") || document.querySelector(".andes-money-amount__fraction");
    var price = priceEl ? priceEl.innerText.trim() : "";
    var sellerEl = document.querySelector(".ui-pdp-seller-summary__link") || document.querySelector(".ui-pdp-seller-summary__link-trigger-button a");
    var seller = sellerEl ? sellerEl.innerText.trim() : "";
    var link = window.location.href.split('?')[0];
    var text = "Titulo: " + title + "\nPrecio: " + price + "\nVendedor: " + seller + "\nLink: " + link;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { alert("✅ ¡Éxito! Copiado al portapapeles:\n\n" + text); },
        function () { window.prompt("Tu navegador bloqueó el portapapeles automático. Copia manualmente:", text); }
      );
    } else { window.prompt("Copia manualmente estos datos:", text); }
  } catch (e) { alert("Error extrayendo datos: " + e.message); }
};

function bookmarkletHref() {
  const raw = "(" + bookmarkletSource.toString() + ")();";
  return "javascript:" + encodeURIComponent(raw);
}

function parsePastedText(text) {
  const get = (label) => {
    const re = new RegExp(label + "\\s*:\\s*(.+)", "i");
    const m = text.match(re);
    return m ? m[1].trim() : "";
  };
  return { title: get("t[ií]tulo"), price: get("precio"), seller: get("vendedor"), link: get("link") };
}

function resizeImage(file, maxWidth = 900, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- INICIALIZACIÓN DE SUPABASE ----------
// PEGA AQUÍ TUS CREDENCIALES (Asegúrate de poner las tuyas)
const supabaseUrl = 'TU_SUPABASE_URL_AQUÍ';
const supabaseKey = 'TU_SUPABASE_ANON_KEY_AQUÍ';
const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);


// ---------- App Component ----------

function App() {
  const [tab, setTab] = useState("catalogo");
  const [products, setProducts] = useState([]);
  const [hiddenIds, setHiddenIds] = useState([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [search, setSearch] = useState("");
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50; 

  const [selectedProduct, setSelectedProduct] = useState(null);
  const [form, setForm] = useState({ compTitle: "", compPrice: "", compSeller: "", compLink: "", imageData: "" });
  const [toast, setToast] = useState("");
  const [evidences, setEvidences] = useState([]);
  const [loadingEvidences, setLoadingEvidences] = useState(true);
  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  // Carga del catálogo local
  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_CATALOG_KEY, false);
        if (res && res.value) setProducts(JSON.parse(res.value));
        const resHidden = await window.storage.get("catalogo-ocultos", false);
        if (resHidden && resHidden.value) setHiddenIds(JSON.parse(resHidden.value));
      } catch (e) {}
      setLoadingCatalog(false);
    })();
  }, []);

  // Carga de evidencias desde Supabase
  const loadEvidences = useCallback(async () => {
    setLoadingEvidences(true);
    try {
      const { data, error } = await supabase
        .from('evidencias')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      if (data) {
        const items = data.map(item => ({
            id: item.id,
            createdAt: new Date(item.created_at).getTime(),
            sku: item.sku,
            ownTitle: item.own_title,
            ownPrice: item.own_price || "",
            ownLink: item.own_link || "",
            compTitle: item.comp_title,
            compPrice: item.comp_price,
            compSeller: item.comp_seller,
            compLink: item.comp_link,
            imageData: item.image_url
        }));
        setEvidences(items);
      }
    } catch (e) { 
      console.error(e);
      setEvidences([]); 
    }
    setLoadingEvidences(false);
  }, []);

  useEffect(() => { loadEvidences(); }, [loadEvidences]);

  useEffect(() => { setCurrentPage(1); }, [search]);

  async function handleExcelUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoadingCatalog(true); 
    
    setTimeout(async () => {
        const data = await file.arrayBuffer();
        const wb = XLSX.read(data);
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        const parsed = rows
          .map((row, i) => ({
            id: i,
            sku: pickField(row, ["sku", "codigo", "código"]),
            title: pickField(row, ["titulo", "título", "producto", "nombre"]),
            price: pickField(row, ["precio", "price"]),
            link: pickField(row, ["link", "url", "publicacion", "publicación"]),
          }))
          .filter((p) => p.title);
        setProducts(parsed);
        try {
          await window.storage.set(STORAGE_CATALOG_KEY, JSON.stringify(parsed), false);
          showToast(`Catálogo cargado: ${parsed.length} productos`);
        } catch (err) { showToast("El catálogo se cargó pero no se pudo guardar"); }
        setLoadingCatalog(false);
        e.target.value = "";
    }, 100);
  }

  function openInML(title) { window.open(mlSearchUrl(title), "_blank", "noopener,noreferrer"); }

  function startEvidence(product) {
    setSelectedProduct(product);
    setForm({ compTitle: "", compPrice: "", compSeller: "", compLink: "", imageData: "" });
    setTab("registrar");
  }

  async function hideProduct(id) {
    const newHidden = [...hiddenIds, id];
    setHiddenIds(newHidden);
    try { await window.storage.set("catalogo-ocultos", JSON.stringify(newHidden), false); } catch (e) {}
    showToast("Producto ocultado de la lista");
  }

  async function restoreHidden() {
    setHiddenIds([]);
    try { await window.storage.delete("catalogo-ocultos", false); } catch (e) {}
    showToast("Todos los productos ocultos han sido restaurados");
  }

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText();
      const parsed = parsePastedText(text);
      setForm((f) => ({
        ...f,
        compTitle: parsed.title || f.compTitle,
        compPrice: parsed.price || f.compPrice,
        compSeller: parsed.seller || f.compSeller,
        compLink: parsed.link || f.compLink,
      }));
      showToast("Datos pegados desde el portapapeles");
    } catch (e) { showToast("No se pudo leer el portapapeles"); }
  }

  // --- NUEVA FUNCIÓN: Pegar imagen con Ctrl+V ---
  async function handleImagePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        e.preventDefault(); // Evitamos comportamiento por defecto
        const file = items[i].getAsFile();
        if (!file) continue;
        try {
          const dataUrl = await resizeImage(file);
          setForm((f) => ({ ...f, imageData: dataUrl }));
          showToast("📸 Captura de pantalla pegada con éxito");
        } catch (err) { 
          showToast("❌ No se pudo procesar la imagen"); 
        }
        return; // Terminamos porque ya encontramos la imagen
      }
    }
  }

  async function handleImageChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImage(file);
      setForm((f) => ({ ...f, imageData: dataUrl }));
    } catch (err) { showToast("No se pudo procesar la imagen"); }
  }

  // --- GUARDADO EN SUPABASE ---
  async function saveEvidence() {
    if (!selectedProduct) return showToast("Selecciona un producto del catálogo");
    if (!form.compTitle || !form.compPrice) return showToast("Falta el título o el precio de la competencia");
    if (!form.imageData) return showToast("Falta adjuntar la captura de pantalla");

    showToast("Subiendo evidencia a la nube... ⏳");

    try {
      const base64Response = await fetch(form.imageData);
      const blob = await base64Response.blob();
      const fileName = `${selectedProduct.sku || 'N/A'}_${Date.now()}.jpg`;

      const { error: uploadError } = await supabase.storage
          .from('evidencias-imagenes')
          .upload(fileName, blob);

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
          .from('evidencias-imagenes')
          .getPublicUrl(fileName);

      const { error: dbError } = await supabase.from('evidencias').insert([
          {
              sku: selectedProduct.sku,
              own_title: selectedProduct.title,
              own_price: String(selectedProduct.price),
              own_link: selectedProduct.link,
              comp_title: form.compTitle,
              comp_price: form.compPrice,
              comp_seller: form.compSeller,
              comp_link: form.compLink,
              image_url: publicUrlData.publicUrl
          }
      ]);

      if (dbError) throw dbError;

      showToast("✅ ¡Evidencia guardada exitosamente en la Nube!");
      setForm({ compTitle: "", compPrice: "", compSeller: "", compLink: "", imageData: "" });
      loadEvidences();
      setTab("catalogo"); 
    } catch (err) { 
      console.error(err);
      showToast("❌ Error al guardar. Revisa consola (F12)"); 
    }
  }

  // --- ELIMINAR DE SUPABASE ---
  async function deleteEvidence(ev) {
    if(!confirm("¿Seguro que deseas eliminar permanentemente esta evidencia de la nube?")) return;
    try {
      if (ev.imageData) {
          const fileName = ev.imageData.split('/').pop();
          await supabase.storage.from('evidencias-imagenes').remove([fileName]);
      }
      await supabase.from('evidencias').delete().eq('id', ev.id);
      
      showToast("🗑️ Evidencia eliminada de la nube");
      loadEvidences();
    } catch (err) { 
      showToast("No se pudo eliminar el registro"); 
    }
  }

  function exportExcel() {
    if (evidences.length === 0) return showToast("No hay evidencias para exportar");
    const rows = evidences.map((ev) => ({
      SKU: ev.sku,
      "Producto propio": ev.ownTitle, "Precio propio": ev.ownPrice, "Link propio": ev.ownLink,
      "Producto competencia": ev.compTitle, "Precio competencia": ev.compPrice, "Vendedor competencia": ev.compSeller, "Link competencia": ev.compLink,
      "Link a Captura": ev.imageData || "Sin imagen",
      Fecha: new Date(ev.createdAt).toLocaleString("es-MX"),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [ { wch: 12 }, { wch: 30 }, { wch: 14 }, { wch: 28 }, { wch: 30 }, { wch: 14 }, { wch: 20 }, { wch: 28 }, { wch: 35 }, { wch: 18 } ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Evidencias");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reporte-competencia-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const filteredProducts = products.filter((p) => {
    if (hiddenIds.includes(p.id)) return false;
    const q = norm(search);
    if (!q) return true;
    return norm(p.title).includes(q) || norm(p.sku).includes(q);
  });

  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
  
  const paginatedProducts = filteredProducts.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  return (
    <div style={styles.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-thumb { background: #3d4457; border-radius: 4px; }
        button { font-family: inherit; cursor: pointer; }
        input, select { font-family: inherit; }
        /* Efecto al seleccionar la zona de pegado de imagen */
        .zona-pegado:focus { border-color: #C9A227 !important; background-color: #232937 !important; outline: none; }
      `}</style>

      <header style={styles.header}>
        <div style={styles.brand}>
          <Guitar size={22} color="#C9A227" />
          <span style={styles.brandText}>Radar de Competencia</span>
        </div>
        <nav style={styles.nav}>
          {[
            { id: "catalogo", label: "Catálogo" },
            { id: "registrar", label: "Registrar evidencia" },
            { id: "evidencias", label: `Evidencias Nube (${evidences.length})` },
            { id: "marcador", label: "Marcador de navegador" },
          ].map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ ...styles.navBtn, ...(tab === t.id ? styles.navBtnActive : {}) }}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {toast && <div style={styles.toast}>{toast}</div>}

      <main style={styles.main}>
        {tab === "catalogo" && (
          <section>
            <div style={styles.rowBetween}>
              <div>
                <h2 style={styles.h2}>Catálogo propio</h2>
                <p style={styles.muted}>Sube tu Excel con columnas SKU, Título, Precio y Link. Se guarda en este navegador de forma ultra rápida.</p>
              </div>
              <label style={styles.uploadBtn}>
                <Upload size={16} /> Cargar Excel
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelUpload} style={{ display: "none" }} />
              </label>
            </div>

            {!loadingCatalog && products.length > 0 && (
              <div style={{ display: "flex", gap: "10px", marginBottom: "16px", alignItems: "center" }}>
                <input placeholder="Buscar por título o SKU..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...styles.searchInput, marginBottom: 0, flex: 1 }} />
                {hiddenIds.length > 0 && (
                  <button style={{ ...styles.smallBtnGhost, margin: 0, height: "100%" }} onClick={restoreHidden} title="Restaurar productos ocultos">
                    👁️ Restaurar ocultos ({hiddenIds.length})
                  </button>
                )}
              </div>
            )}

            {loadingCatalog ? (
              <div style={styles.emptyState}>
                 <p>Cargando y procesando catálogo...</p>
              </div>
            ) : products.length === 0 ? (
              <div style={styles.emptyState}>
                <p>Aún no hay productos cargados.</p>
                <p style={styles.mutedSmall}>Sube tu Excel para empezar a comparar precios contra la competencia.</p>
              </div>
            ) : (
              <>
                <div style={styles.tableWrap}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>SKU</th>
                        <th style={styles.th}>Producto</th>
                        <th style={styles.th}>Precio</th>
                        <th style={styles.th}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedProducts.map((p) => (
                        <tr key={p.id} style={styles.tr}>
                          <td style={styles.tdMono}>{p.sku || "-"}</td>
                          <td style={styles.td}>{p.title}</td>
                          <td style={styles.tdMono}>{currency(p.price)}</td>
                          <td style={{ ...styles.td, textAlign: "right" }}>
                            <button style={styles.smallBtnGhost} onClick={() => hideProduct(p.id)} title="Ocultar producto de la lista">
                              🙈 Ocultar
                            </button>
                            <button style={styles.smallBtnGhost} onClick={() => openInML(p.title)} title="Buscar en Mercado Libre">
                              <Search size={14} /> Buscar en ML
                            </button>
                            <button style={styles.smallBtnGold} onClick={() => startEvidence(p)} title="Registrar evidencia de competencia">
                              Registrar <ChevronRight size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {paginatedProducts.length === 0 && (
                          <tr><td colSpan="4" style={{...styles.td, textAlign: 'center', color: '#9198A8'}}>No se encontraron resultados</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {totalPages > 1 && (
                  <div style={styles.pagination}>
                    <button 
                      style={styles.pageBtn} 
                      disabled={currentPage === 1} 
                      onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                    >
                      Anterior
                    </button>
                    <span style={styles.pageText}>Página {currentPage} de {totalPages} ({filteredProducts.length} resultados)</span>
                    <button 
                      style={styles.pageBtn} 
                      disabled={currentPage === totalPages} 
                      onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                    >
                      Siguiente
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {tab === "registrar" && (
          <section style={styles.twoCol}>
            <div style={styles.card}>
              <h2 style={styles.h2}>1. Producto propio</h2>
              {selectedProduct ? (
                <div>
                  <p style={styles.productLine}><Tag size={14} color="#C9A227" /> {selectedProduct.sku}</p>
                  <p style={styles.productTitle}>{selectedProduct.title}</p>
                  <p style={styles.productPrice}>{currency(selectedProduct.price)}</p>
                  <button style={styles.smallBtnGhost} onClick={() => openInML(selectedProduct.title)}>
                    <Search size={14} /> Abrir búsqueda en ML
                  </button>
                </div>
              ) : (
                <div>
                  <p style={styles.muted}>No has seleccionado ningún producto. Ve al catálogo y presiona "Registrar" en el producto que quieras comparar.</p>
                  <button style={styles.smallBtnGold} onClick={() => setTab("catalogo")}>Ir al catálogo</button>
                </div>
              )}
              <div style={styles.hint}>
                <p style={styles.hintTitle}>Cómo capturar los datos de la competencia</p>
                <ol style={styles.hintList}>
                  <li>Busca la publicación de la competencia en Mercado Libre.</li>
                  <li>Da clic en el marcador "Capturar ML" de tu navegador.</li>
                  <li>Los datos se copian solos al portapapeles.</li>
                  <li>Regresa aquí y presiona "Pegar del portapapeles".</li>
                </ol>
              </div>
            </div>

            <div style={styles.card}>
              <h2 style={styles.h2}>2. Publicación de la competencia</h2>
              <button style={styles.pasteBtn} onClick={handlePaste}><ClipboardPaste size={16} /> Pegar del portapapeles</button>
              
              <label style={styles.label}>Título de la publicación</label>
              <input style={styles.input} value={form.compTitle} onChange={(e) => setForm((f) => ({ ...f, compTitle: e.target.value }))} placeholder="Ej. Guitarra Eléctrica Fender" />
              
              <label style={styles.label}>Precio</label>
              <input style={styles.input} value={form.compPrice} onChange={(e) => setForm((f) => ({ ...f, compPrice: e.target.value }))} placeholder="Ej. $4,999" />
              
              <label style={styles.label}>Vendedor</label>
              <input style={styles.input} value={form.compSeller} onChange={(e) => setForm((f) => ({ ...f, compSeller: e.target.value }))} placeholder="Nombre de la tienda o vendedor" />
              
              <label style={styles.label}>Link de la publicación</label>
              <input style={styles.input} value={form.compLink} onChange={(e) => setForm((f) => ({ ...f, compLink: e.target.value }))} placeholder="https://articulo.mercadolibre.com.mx/..." />
              
              <label style={styles.label}>Captura de pantalla (evidencia)</label>
              
              {/* --- ZONA DE PEGADO DE IMAGEN ACTUALIZADA --- */}
              <label 
                className="zona-pegado"
                style={{...styles.imageDrop, outline: "none"}} 
                tabIndex="0" 
                onPaste={handleImagePaste}
              >
                <ImageIcon size={18} color="#8a93a6" />
                <span>
                  {form.imageData 
                    ? "✅ Imagen lista (Haz clic y Ctrl+V para cambiar)" 
                    : "Haz clic aquí y presiona Ctrl + V para pegar captura"}
                </span>
                <input ref={imageInputRef} type="file" accept="image/*" onChange={handleImageChange} style={{ display: "none" }} />
              </label>

              {form.imageData && <img src={form.imageData} alt="evidencia" style={styles.preview} />}
              
              <button style={styles.saveBtn} onClick={saveEvidence}><Save size={16} /> Guardar evidencia en Supabase</button>
            </div>
          </section>
        )}

        {tab === "evidencias" && (
          <section>
            <div style={styles.rowBetween}>
              <div>
                <h2 style={styles.h2}>Evidencias alojadas en la Nube</h2>
                <p style={styles.muted}>Registro sincronizado con Supabase. Cero límites de memoria.</p>
              </div>
              <button style={styles.uploadBtn} onClick={exportExcel}><Download size={16} /> Exportar a Excel</button>
            </div>

            {loadingEvidences ? (
              <p style={styles.muted}>Descargando de Supabase...</p>
            ) : evidences.length === 0 ? (
              <div style={styles.emptyState}><p>Todavía no hay evidencias en la nube.</p></div>
            ) : (
              <div style={styles.cardsGrid}>
                {evidences.map((ev) => (
                  <div key={ev.id} style={styles.evCard}>
                    {ev.imageData ? <img src={ev.imageData} alt="" style={styles.evThumb} /> : <div style={styles.evThumbPlaceholder}><ImageIcon size={22} color="#5c6478" /></div>}
                    <div style={styles.evBody}>
                      <p style={styles.evSku}>{ev.sku}</p>
                      <p style={styles.evOwn}>{ev.ownTitle}</p>
                      <p style={styles.evOwnPrice}>{currency(ev.ownPrice)}</p>
                      <div style={styles.evDivider} />
                      <p style={styles.evComp}>{ev.compTitle}</p>
                      <p style={styles.evCompPrice}>{currency(ev.compPrice)}</p>
                      <p style={styles.evSeller}><Store size={12} /> {ev.compSeller || "Vendedor no especificado"}</p>
                      {ev.compLink && <a href={ev.compLink} target="_blank" rel="noopener noreferrer" style={styles.evLink}><Link2 size={12} /> Ver publicación</a>}
                      <p style={styles.evDate}>{new Date(ev.createdAt).toLocaleString("es-MX")}</p>
                    </div>
                    <button style={styles.deleteBtn} onClick={() => deleteEvidence(ev)} title="Eliminar de la nube"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === "marcador" && (
          <section style={styles.card}>
            <h2 style={styles.h2}>Marcador de navegador (bookmarklet)</h2>
            <p style={styles.muted}>Arrastra el siguiente botón a tu barra de marcadores para extraer datos en Mercado Libre.</p>
            <a href={bookmarkletHref()} style={styles.bookmarkletLink} onClick={(e) => e.preventDefault()}>📌 Capturar ML</a>
          </section>
        )}
      </main>
    </div>
  );
}

// ---------- Styles ----------
const styles = {
  app: { minHeight: "100vh", background: "#181D28", color: "#EDE6DA", fontFamily: "'Inter', sans-serif", padding: "0 0 60px" },
  header: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "18px 28px", borderBottom: "1px solid #2A3142", position: "sticky", top: 0, background: "#181D28", zIndex: 10 },
  brand: { display: "flex", alignItems: "center", gap: 8 },
  brandText: { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 18, letterSpacing: "-0.01em" },
  nav: { display: "flex", gap: 6, flexWrap: "wrap" },
  navBtn: { background: "transparent", border: "1px solid #2A3142", color: "#B7BECC", padding: "8px 14px", borderRadius: 8, fontSize: 13.5, fontWeight: 500 },
  navBtnActive: { background: "#C9A227", borderColor: "#C9A227", color: "#181D28", fontWeight: 600 },
  main: { padding: "28px", maxWidth: 1180, margin: "0 auto" },
  h2: { fontFamily: "'Space Grotesk', sans-serif", fontSize: 21, fontWeight: 600, margin: "0 0 4px" },
  muted: { color: "#9198A8", fontSize: 14, margin: "4px 0 16px" },
  mutedSmall: { color: "#78808f", fontSize: 12.5, marginTop: 10 },
  rowBetween: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 8 },
  uploadBtn: { display: "flex", alignItems: "center", gap: 8, background: "#C9A227", color: "#181D28", border: "none", padding: "10px 16px", borderRadius: 8, fontWeight: 600, fontSize: 13.5 },
  searchInput: { width: "100%", background: "#1F2531", border: "1px solid #2A3142", borderRadius: 8, padding: "10px 14px", color: "#EDE6DA", fontSize: 14, marginBottom: 16, outline: "none" },
  tableWrap: { border: "1px solid #2A3142", borderRadius: 10, overflow: "hidden" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", padding: "12px 16px", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em", color: "#8891A3", background: "#1F2531", borderBottom: "1px solid #2A3142" },
  tr: { borderBottom: "1px solid #232937" },
  td: { padding: "12px 16px", fontSize: 14 },
  tdMono: { padding: "12px 16px", fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: "#C9A227", whiteSpace: "nowrap" },
  smallBtnGhost: { display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "1px solid #3A4256", color: "#B7BECC", padding: "7px 12px", borderRadius: 7, fontSize: 12.5, marginRight: 8 },
  smallBtnGold: { display: "inline-flex", alignItems: "center", gap: 4, background: "#C9A227", border: "none", color: "#181D28", padding: "7px 12px", borderRadius: 7, fontSize: 12.5, fontWeight: 600 },
  emptyState: { border: "1px dashed #2A3142", borderRadius: 10, padding: "40px 20px", textAlign: "center", color: "#9198A8" },
  twoCol: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 },
  card: { background: "#1F2531", border: "1px solid #2A3142", borderRadius: 12, padding: 22 },
  productLine: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#9198A8", margin: "6px 0 2px" },
  productTitle: { fontSize: 17, fontWeight: 600, margin: "2px 0 6px" },
  productPrice: { fontFamily: "'JetBrains Mono', monospace", color: "#C9A227", fontSize: 15, marginBottom: 14 },
  hint: { marginTop: 20, paddingTop: 16, borderTop: "1px solid #2A3142" },
  hintTitle: { fontSize: 13, fontWeight: 600, marginBottom: 8, color: "#D7CDBE" },
  hintList: { fontSize: 13, color: "#9198A8", paddingLeft: 18, lineHeight: 1.7 },
  pasteBtn: { display: "flex", alignItems: "center", gap: 8, background: "#2A3142", border: "1px solid #3A4256", color: "#EDE6DA", padding: "10px 14px", borderRadius: 8, fontSize: 13.5, fontWeight: 500, marginBottom: 16, width: "100%", justifyContent: "center" },
  label: { display: "block", fontSize: 12, color: "#8891A3", marginTop: 12, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.03em" },
  input: { width: "100%", background: "#181D28", border: "1px solid #2A3142", borderRadius: 8, padding: "10px 12px", color: "#EDE6DA", fontSize: 14, outline: "none" },
  imageDrop: { display: "flex", alignItems: "center", gap: 8, border: "1px dashed #3A4256", borderRadius: 8, padding: "12px", color: "#B7BECC", fontSize: 13.5, cursor: "pointer", transition: "0.2s" },
  preview: { width: "100%", borderRadius: 8, marginTop: 10, border: "1px solid #2A3142" },
  saveBtn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", background: "#C9A227", border: "none", color: "#181D28", padding: "12px", borderRadius: 8, fontSize: 14.5, fontWeight: 700, marginTop: 20 },
  cardsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 },
  evCard: { background: "#1F2531", border: "1px solid #2A3142", borderRadius: 12, overflow: "hidden", position: "relative" },
  evThumb: { width: "100%", height: 150, objectFit: "cover" },
  evThumbPlaceholder: { width: "100%", height: 150, background: "#181D28", display: "flex", alignItems: "center", justifyContent: "center" },
  evBody: { padding: 14 },
  evSku: { fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#78808f", margin: 0 },
  evOwn: { fontSize: 13.5, fontWeight: 600, margin: "4px 0 2px" },
  evOwnPrice: { fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: "#9198A8", margin: 0 },
  evDivider: { height: 1, background: "#2A3142", margin: "10px 0" },
  evComp: { fontSize: 13.5, fontWeight: 600, margin: "0 0 2px", color: "#EDE6DA" },
  evCompPrice: { fontFamily: "'JetBrains Mono', monospace", fontSize: 14, color: "#C9A227", margin: "0 0 6px" },
  evSeller: { display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#9198A8", margin: "0 0 4px" },
  evLink: { display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#C9A227", textDecoration: "none", wordBreak: "break-all" },
  evDate: { fontSize: 11, color: "#5c6478", marginTop: 8 },
  deleteBtn: { position: "absolute", top: 10, right: 10, background: "rgba(24,29,40,0.8)", border: "1px solid #3A4256", color: "#e0a0a0", borderRadius: 6, padding: 6, display: "flex", cursor: "pointer" },
  bookmarkletLink: { display: "inline-block", background: "#2A3142", border: "2px dashed #C9A227", color: "#EDE6DA", padding: "12px 20px", borderRadius: 8, fontWeight: 600, fontSize: 14, textDecoration: "none", marginBottom: 8 },
  toast: { position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#C9A227", color: "#181D28", padding: "10px 18px", borderRadius: 8, fontSize: 13.5, fontWeight: 600, zIndex: 100, boxShadow: "0 8px 24px rgba(0,0,0,0.35)" },
  pagination: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px", padding: "10px 0" },
  pageBtn: { background: "#1F2531", border: "1px solid #3A4256", color: "#EDE6DA", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  pageText: { color: "#9198A8", fontSize: 13 }
};