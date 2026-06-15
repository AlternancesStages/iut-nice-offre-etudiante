import { useState, useEffect, useMemo, useRef } from "react";

// COMPOSANT CUSTOM : RÉPLIQUE ABSOLUE DU WIDGET MULTISELECT DE STREAMLIT
interface MultiSelectProps {
  label: string;
  placeholder: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

export default function MultiSelect({
  label,
  placeholder,
  options,
  selected,
  onChange,
}: MultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Réinitialiser la recherche lors de la fermeture
  useEffect(() => {
    if (!isOpen) {
      setSearchTerm("");
    }
  }, [isOpen]);

  const handleSelect = (option: string) => {
    if (!selected.includes(option)) {
      onChange([...selected, option]);
      setSearchTerm(""); // Reset search after select
    }
  };

  const handleRemove = (option: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(selected.filter((item) => item !== option));
  };

  const handleClearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  const filteredUnselectedOptions = useMemo(() => {
    const unselected = options.filter((opt) => !selected.includes(opt));
    if (!searchTerm.trim()) return unselected;
    const term = searchTerm.toLowerCase();
    return unselected.filter((opt) => opt.toLowerCase().includes(term));
  }, [options, selected, searchTerm]);

  return (
    <div className="mb-5" ref={containerRef}>
      <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5 select-none">
        {label}
      </label>
      
      <div
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full min-h-[38px] bg-white border rounded-xl p-1.5 flex flex-wrap items-center gap-1.5 cursor-pointer relative transition-all ${
          isOpen ? "border-[#00afda] ring-4 ring-[#00afda]/5" : "border-gray-200/80 hover:border-[#00afda]"
        }`}
      >
        {selected.length === 0 ? (
          <span className="text-xs text-gray-400 pl-1.5 select-none">{placeholder}</span>
        ) : (
          selected.map((item) => (
            <span
              key={item}
              className="inline-flex items-center bg-slate-50 text-slate-700 border border-slate-100 text-[11px] font-semibold px-2 py-0.5 rounded-lg gap-1 transition-all hover:bg-slate-100"
            >
              <span>{item}</span>
              <button
                onClick={(e) => handleRemove(item, e)}
                className="text-gray-400 hover:text-gray-700 font-bold focus:outline-none w-3 h-3 flex items-center justify-center text-xs"
              >
                ✕
              </button>
            </span>
          ))
        )}

        <div className="ml-auto flex items-center gap-1.5 pr-1.5 text-gray-400">
          {selected.length > 0 && (
            <button
              onClick={handleClearAll}
              className="hover:text-gray-700 text-xs font-bold p-0.5 focus:outline-none"
              title="Tout effacer"
            >
              ✕
            </button>
          )}
          <span className="text-[9px] select-none transition-transform duration-200" style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }}>
            ▼
          </span>
        </div>

        {isOpen && (
          <div className="relative w-full bg-white border border-gray-200 rounded-xl shadow-inner mt-1.5 max-h-56 overflow-y-auto z-10 py-2.5 animate-fadeIn custom-scrollbar">
            {/* Input de recherche interne  */}
            <div className="px-2.5 pb-2 border-b border-gray-100 mb-1.5" onClick={(e) => e.stopPropagation()}>
              <input
                type="text"
                placeholder="Rechercher..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#00afda] transition-colors"
                autoFocus
              />
            </div>

            {filteredUnselectedOptions.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-400 italic select-none">
                Aucun résultat
              </div>
            ) : (
              filteredUnselectedOptions.map((opt) => (
                <div
                  key={opt}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelect(opt);
                  }}
                  className="px-3.5 py-2 text-xs text-gray-700 hover:bg-gray-100 hover:text-gray-900 transition-colors cursor-pointer select-none"
                >
                  {opt}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
