import { useRef } from "react";
import { getPaginationRange } from "../utils";

export default function Pagination({ currentPage, totalPages, onPageChange }: { currentPage: number; totalPages: number; onPageChange: (page: number) => void }) {
  if (totalPages <= 1) return null;

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  return (
    <nav className="relative flex justify-between sm:justify-center items-center gap-2 sm:gap-4 mt-8 bg-gray-200 border border-gray-100 rounded-xl p-3 shadow-md select-none">
      <button
        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        disabled={currentPage === 1}
        className="flex items-center gap-1 px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs font-bold bg-gray-50 border border-gray-200 text-gray-700 hover:text-gray-900 hover:bg-gray-100 disabled:opacity-30 disabled:pointer-events-none transition-all active:scale-95 shrink-0"
      >
        ← <span className="hidden sm:inline">Précédent</span>
      </button>

      {/* Container for pagination buttons with scrollability and dynamic custom horizontal scrollbar */}
      <div className="flex-1 sm:flex-initial min-w-0 flex items-center">
        <div 
          ref={scrollContainerRef}
          className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto whitespace-nowrap custom-horizontal-scrollbar pt-1 pb-2.5 px-4 mx-auto max-w-full"
        >
          {getPaginationRange(currentPage, totalPages).map((p, idx) => {
            if (p === "...") {
              return (
                <span key={`dots-${idx}`} className="w-8 h-8 flex items-center justify-center text-gray-400 font-bold select-none text-xs shrink-0">...</span>
              );
            }
            const isActive = currentPage === p;
            return (
              <button
                key={`page-${p}`}
                onClick={() => onPageChange(p as number)}
                className={`w-8 h-8 flex items-center justify-center text-xs font-bold rounded-lg transition-all active:scale-90 shrink-0 ${
                  isActive ? "bg-[#00afda] text-white shadow-sm border-none" : "bg-gray-50 border border-gray-200 text-gray-700 hover:bg-gray-100 hover:text-gray-900 hover:border-gray-200"
                }`}
              >
                {p}
              </button>
            );
          })}
        </div>
      </div>

      <button
        onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
        disabled={currentPage === totalPages}
        className="flex items-center gap-1 px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs font-bold bg-gray-50 border border-gray-200 text-gray-700 hover:text-gray-900 hover:bg-gray-100 disabled:opacity-30 disabled:pointer-events-none transition-all active:scale-95 shrink-0"
      >
        <span className="hidden sm:inline">Suivant</span> →
      </button>
    </nav>
  );
}

