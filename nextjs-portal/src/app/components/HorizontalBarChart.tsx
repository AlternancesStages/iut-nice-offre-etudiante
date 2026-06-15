import { useMemo } from "react";

export default function HorizontalBarChart({ title, data }: { title: string; data: [string, number][] }) {
  const maxVal = useMemo(() => {
    if (data.length === 0) return 1;
    return Math.max(...data.map(d => d[1]));
  }, [data]);

  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-5 flex flex-col gap-4 shadow-sm">
      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 pb-2 select-none">
        {title}
      </h4>
      {data.length === 0 ? (
        <p className="text-xs text-gray-400 italic py-8 text-center select-none">Aucune donnée à afficher</p>
      ) : (
        <div className="flex flex-col gap-3">
          {data.map(([label, count]) => {
            const pct = (count / maxVal) * 100;
            return (
              <div key={label} className="flex flex-col gap-1 select-none">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-slate-700 truncate max-w-[190px]" title={label}>{label}</span>
                  <span className="text-slate-500 font-bold">{count}</span>
                </div>
                <div className="w-full bg-slate-50 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-[#d8005e] to-[#4b192f] h-full rounded-full transition-all duration-700 ease-out shadow-[0_0_8px_rgba(216,0,94,0.25)]"
                    style={{ width: `${pct}%` }}
                  ></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

