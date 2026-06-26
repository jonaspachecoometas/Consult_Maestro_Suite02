import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Target } from "lucide-react";

interface MaturityDataPoint {
  subject: string;
  fullName: string;
  atual: number;
  sistemico?: number;
  fullMark: number;
}

interface MaturityRadarChartProps {
  data: MaturityDataPoint[];
  title?: string;
  showComparison?: boolean;
  height?: number;
}

export function MaturityRadarChart({ 
  data, 
  title = "Mapa de Maturidade", 
  showComparison = true,
  height = 350 
}: MaturityRadarChartProps) {
  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-[200px] text-muted-foreground">
            Sem dados suficientes para gerar o grafico
          </div>
        </CardContent>
      </Card>
    );
  }

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-popover border border-border rounded-md p-3 shadow-lg">
          <p className="font-medium text-sm mb-1">{data.fullName}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-xs" style={{ color: entry.color }}>
              {entry.name}: {entry.value.toFixed(1)}/10
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
            <PolarGrid stroke="hsl(var(--border))" />
            <PolarAngleAxis 
              dataKey="subject" 
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              tickLine={false}
            />
            <PolarRadiusAxis 
              angle={30} 
              domain={[0, 10]} 
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
              tickCount={6}
            />
            <Radar
              name="Atual"
              dataKey="atual"
              stroke="hsl(var(--primary))"
              fill="hsl(var(--primary))"
              fillOpacity={0.3}
              strokeWidth={2}
            />
            {showComparison && data.some(d => d.sistemico !== undefined) && (
              <Radar
                name="Sistemico"
                dataKey="sistemico"
                stroke="hsl(142 76% 36%)"
                fill="hsl(142 76% 36%)"
                fillOpacity={0.2}
                strokeWidth={2}
                strokeDasharray="5 5"
              />
            )}
            <Tooltip content={<CustomTooltip />} />
            <Legend 
              wrapperStyle={{ fontSize: 12 }}
              iconType="line"
            />
          </RadarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

interface ProcessMaturityData {
  category: string;
  score: number;
  count: number;
}

interface ProcessMaturityRadarProps {
  data: ProcessMaturityData[];
  title?: string;
  height?: number;
}

export function ProcessMaturityRadar({ 
  data, 
  title = "Maturidade por Categoria",
  height = 300 
}: ProcessMaturityRadarProps) {
  const chartData = data.map(d => ({
    subject: d.category.substring(0, 8),
    fullName: d.category,
    score: d.score,
    fullMark: 100,
  }));

  if (!chartData || chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-[200px] text-muted-foreground">
            Sem dados suficientes para gerar o grafico
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <RadarChart cx="50%" cy="50%" outerRadius="70%" data={chartData}>
            <PolarGrid stroke="hsl(var(--border))" />
            <PolarAngleAxis 
              dataKey="subject" 
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              tickLine={false}
            />
            <PolarRadiusAxis 
              angle={30} 
              domain={[0, 100]} 
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
              tickCount={6}
            />
            <Radar
              name="Score"
              dataKey="score"
              stroke="hsl(var(--primary))"
              fill="hsl(var(--primary))"
              fillOpacity={0.4}
              strokeWidth={2}
            />
            <Tooltip 
              formatter={(value: number) => [`${value.toFixed(0)}%`, "Maturidade"]}
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "6px",
              }}
            />
          </RadarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export function getMaturityLevel(score: number): { label: string; color: string } {
  if (score >= 90) return { label: "Otimizado", color: "text-green-600" };
  if (score >= 70) return { label: "Avancado", color: "text-blue-600" };
  if (score >= 50) return { label: "Em Desenvolvimento", color: "text-yellow-600" };
  if (score >= 30) return { label: "Inicial", color: "text-orange-600" };
  return { label: "Critico", color: "text-red-600" };
}
