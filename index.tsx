import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';

interface Flight {
    airline: string;
    stops: number;
    price: number;
    class: string;
}

interface Location {
    city: string;
    lat: number;
    lng: number;
}

interface ChecklistItem {
    task: string;
    details: string;
    completed: boolean;
}

interface PackingItem {
    item: string;
    quantity: number;
    packed: boolean;
}

interface PackingCategory {
    category: string;
    items: PackingItem[];
}

interface WeatherInfo {
    destination: string;
    avg_temp_celsius: number;
    forecast_summary: string;
}

interface FoodRecommendation {
    name: string;
    description: string;
}

interface ItineraryDestination {
    destination_name: string;
    destination_summary: string;
    daily_plan: {
        day: number;
        activity: string;
    }[];
    transport_tips: string;
    safety_tips: string;
    food_recommendations: FoodRecommendation[];
    imageUrl?: string | 'loading' | null;
}

interface CostDetails {
    accommodation: number;
    food: number;
    activities: number;
    transport: number;
    total_without_flights: number;
}

interface Plan {
    itinerary: ItineraryDestination[];
    costs: CostDetails;
    checklist: ChecklistItem[];
    flights: Flight[];
    locations: Location[];
    weather: WeatherInfo[];
    packing_list: PackingCategory[];
}

type TripDetails = {
    prediction: number | string;
    type: string;
    origin: string;
    destinations: string[];
    adults: number;
    children: number;
    startDate: string;
    endDate: string;
    class: string;
    stopover: boolean;
    tripType: string;
};

interface HistoryItem {
  id: string;
  title: string;
  details: TripDetails;
}

const ResizeMap = ({ bounds }: { bounds: [number, number][] }) => {
    const map = useMap();
    useEffect(() => {
        if (bounds && bounds.length > 0) {
            map.invalidateSize();
            map.fitBounds(bounds, { padding: [50, 50] });
        }
    }, [bounds, map]);
    return null;
};

const getWeatherIcon = (summary: string) => {
    const lowerCaseSummary = summary.toLowerCase();
    if (lowerCaseSummary.includes('sol') || lowerCaseSummary.includes('ensolarado') || lowerCaseSummary.includes('claro')) return '☀️';
    if (lowerCaseSummary.includes('chuva') || lowerCaseSummary.includes('chuvoso')) return '🌧️';
    if (lowerCaseSummary.includes('nuvem') || lowerCaseSummary.includes('nublado')) return '☁️';
    if (lowerCaseSummary.includes('tempestade')) return '⛈️';
    if (lowerCaseSummary.includes('neve')) return '❄️';
    return '🌍'; // Default icon
};

const App = () => {
    const [tripDetails, setTripDetails] = useState<TripDetails>({
        prediction: new Date().getFullYear() + 1,
        type: 'Internacional',
        origin: 'São Paulo',
        destinations: ['Lisboa', 'Londres'],
        adults: 2,
        children: 0,
        startDate: '',
        endDate: '',
        class: 'Econômica',
        stopover: false,
        tripType: 'Aventura',
    });
    const [currentDestination, setCurrentDestination] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [plan, setPlan] = useState<Plan | null>(null);
    const [isSaved, setIsSaved] = useState(false);
    const [searchHistory, setSearchHistory] = useState<HistoryItem[]>([]);
    const [activeTab, setActiveTab] = useState('roteiro');
    const [currentItineraryPage, setCurrentItineraryPage] = useState(0);
    const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null);


    // Filter state
    const [filters, setFilters] = useState({
        airline: 'all',
        stops: 'all',
        maxPrice: ''
    });

    // Infinite scroll state
    const [displayedFlights, setDisplayedFlights] = useState<Flight[]>([]);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const observer = useRef<IntersectionObserver | null>(null);
    const FLIGHTS_PER_PAGE = 10;

    useEffect(() => {
        try {
            const savedPlanData = localStorage.getItem('ernest-travel-plan');
            if (savedPlanData) {
                const { plan: savedPlan, tripDetails: savedTripDetails, selectedFlight: savedFlight }: { plan: Plan, tripDetails: TripDetails, selectedFlight: Flight | null } = JSON.parse(savedPlanData);
                if (savedPlan && savedTripDetails) {
                    const planWithCheckedState = {
                        ...savedPlan,
                        checklist: savedPlan.checklist.map(item => ({ ...item, completed: item.completed || false })),
                        packing_list: savedPlan.packing_list?.map(cat => ({
                            ...cat,
                            items: cat.items.map(item => ({...item, packed: item.packed || false}))
                        }))
                    };
                    setPlan(planWithCheckedState);
                    setTripDetails(savedTripDetails);
                    setSelectedFlight(savedFlight || null);
                    setIsSaved(true);
                }
            }
        } catch (err) {
            console.error("Failed to load or parse saved plan from localStorage", err);
            localStorage.removeItem('ernest-travel-plan');
        }

        try {
            const savedHistory = localStorage.getItem('ernest-travel-history');
            if (savedHistory) {
                setSearchHistory(JSON.parse(savedHistory));
            }
        } catch (err) {
            console.error("Failed to load history from localStorage", err);
            localStorage.removeItem('ernest-travel-history');
        }
    }, []);

    const filteredFlights = useMemo(() => {
        if (!plan?.flights) return [];
        return plan.flights.filter(flight => {
            const airlineMatch = filters.airline === 'all' || flight.airline === filters.airline;
            const stopsMatch = filters.stops === 'all' || String(flight.stops) === filters.stops;
            const priceMatch = filters.maxPrice === '' || !filters.maxPrice || Number(flight.price) <= Number(filters.maxPrice);
            return airlineMatch && stopsMatch && priceMatch;
        });
    }, [plan?.flights, filters]);

    const airlines = useMemo(() => {
        if (!plan?.flights) return [];
        return [...new Set(plan.flights.map(f => f.airline))];
    }, [plan?.flights]);
    
    useEffect(() => {
        if (filteredFlights) {
            setDisplayedFlights(filteredFlights.slice(0, FLIGHTS_PER_PAGE));
        }
    }, [filteredFlights]);

    const lastFlightElementRef = useCallback(node => {
        if (isLoadingMore) return;
        if (observer.current) observer.current.disconnect();
        
        observer.current = new IntersectionObserver(entries => {
            const hasMore = displayedFlights.length < filteredFlights.length;
            if (entries[0].isIntersecting && hasMore) {
                setIsLoadingMore(true);
                setTimeout(() => { // Simulate network request for smoother UX
                    const currentLength = displayedFlights.length;
                    const newFlights = filteredFlights.slice(currentLength, currentLength + FLIGHTS_PER_PAGE);
                    setDisplayedFlights(prev => [...prev, ...newFlights]);
                    setIsLoadingMore(false);
                }, 500);
            }
        });
        
        if (node) observer.current.observe(node);
    }, [isLoadingMore, displayedFlights, filteredFlights]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        const checked = (e.target as HTMLInputElement).checked;
        setTripDetails(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value,
        }));
    };

    const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFilters(prev => ({...prev, [name]: value}));
    };
    
    const handleAddDestination = () => {
        if (currentDestination && !tripDetails.destinations.includes(currentDestination)) {
            setTripDetails(prev => ({
                ...prev,
                destinations: [...prev.destinations, currentDestination],
            }));
            setCurrentDestination('');
        }
    };
    
    const handleRemoveDestination = (destToRemove: string) => {
        setTripDetails(prev => ({
            ...prev,
            destinations: prev.destinations.filter(dest => dest !== destToRemove),
        }));
    };

    const handleLoadHistoryItem = (itemDetails: TripDetails) => {
        setTripDetails(itemDetails);
        setPlan(null);
        setError('');
        setIsSaved(false);
        setCurrentItineraryPage(0);
        setSelectedFlight(null);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleClearHistory = () => {
        if (window.confirm("Tem certeza que deseja limpar o histórico de pesquisas?")) {
            setSearchHistory([]);
            localStorage.removeItem('ernest-travel-history');
        }
    };

    const handleChecklistToggle = (toggledIndex: number) => {
        if (!plan) return;
        const newChecklist = plan.checklist.map((item, index) => {
            if (index === toggledIndex) {
                return { ...item, completed: !item.completed };
            }
            return item;
        });
        setPlan(prevPlan => ({ ...prevPlan!, checklist: newChecklist }));
        setIsSaved(false); // Indicate there are unsaved changes
    };

    const handlePackingListToggle = (categoryIndex: number, itemIndex: number) => {
        if (!plan) return;
        const newPackingList = [...plan.packing_list];
        const category = { ...newPackingList[categoryIndex] };
        const item = { ...category.items[itemIndex] };
        item.packed = !item.packed;
        category.items[itemIndex] = item;
        newPackingList[categoryIndex] = category;
        setPlan(prevPlan => ({ ...prevPlan!, packing_list: newPackingList }));
        setIsSaved(false);
    };

    const handleSelectFlight = (flight: Flight) => {
        if (selectedFlight && JSON.stringify(selectedFlight) === JSON.stringify(flight)) {
            setSelectedFlight(null); // Deselect if the same flight is clicked again
        } else {
            setSelectedFlight(flight);
        }
        setIsSaved(false);
    };

    const generateDestinationImages = async (ai: GoogleGenAI, destinations: ItineraryDestination[]) => {
        // Set loading state for all images
        setPlan(prevPlan => {
            if (!prevPlan) return null;
            const updatedItinerary = prevPlan.itinerary.map(dest => ({ ...dest, imageUrl: 'loading' }));
            return { ...prevPlan, itinerary: updatedItinerary };
        });

        const imagePromises = destinations.map(dest => 
            ai.models.generateImages({
                model: 'imagen-4.0-generate-001',
                prompt: `A beautiful, photorealistic, high-quality travel photograph of ${dest.destination_name}, capturing its essence. No text or people in the foreground.`,
                 config: {
                    numberOfImages: 1,
                    outputMimeType: 'image/jpeg',
                    aspectRatio: '16:9',
                 },
            }).catch(e => {
                console.error(`Failed to generate image for ${dest.destination_name}`, e);
                return null; // Return null on failure
            })
        );
    
        const results = await Promise.allSettled(imagePromises);
    
        results.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value && result.value.generatedImages.length > 0) {
                const base64Image = result.value.generatedImages[0].image.imageBytes;
                setPlan(prevPlan => {
                    if (!prevPlan) return null;
                    const updatedItinerary = [...prevPlan.itinerary];
                    updatedItinerary[index].imageUrl = `data:image/jpeg;base64,${base64Image}`;
                    return { ...prevPlan, itinerary: updatedItinerary };
                });
            } else {
                // Handle failure
                setPlan(prevPlan => {
                    if (!prevPlan) return null;
                    const updatedItinerary = [...prevPlan.itinerary];
                    updatedItinerary[index].imageUrl = null; // Set to null on error
                    return { ...prevPlan, itinerary: updatedItinerary };
                });
            }
        });
    };

    const generatePlan = async () => {
        const apiKey = sessionStorage.getItem('gemini_api_key');
        if (!apiKey) {
            setError('A chave de API não foi encontrada. Por favor, recarregue a página e insira sua chave.');
            return;
        }

        setLoading(true);
        setError('');
        setPlan(null);
        setIsSaved(false);
        setSelectedFlight(null);

        if (tripDetails.startDate && tripDetails.endDate) {
            const startDate = new Date(tripDetails.startDate);
            const endDate = new Date(tripDetails.endDate);
            if (endDate <= startDate) {
                setError('A data de fim da viagem deve ser posterior à data de início. Por favor, ajuste as datas.');
                setLoading(false);
                return;
            }
        }

        try {
            const ai = new GoogleGenAI({ apiKey: apiKey });
            
            const schema = {
                type: Type.OBJECT,
                properties: {
                    itinerary: {
                        type: Type.ARRAY,
                        description: "Roteiro de viagem detalhado, separado por cada cidade de destino.",
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                destination_name: { type: Type.STRING, description: "Nome da cidade de destino." },
                                destination_summary: { type: Type.STRING, description: "Um resumo breve e envolvente sobre o destino." },
                                daily_plan: {
                                    type: Type.ARRAY,
                                    description: "Plano de atividades diárias para este destino.",
                                    items: {
                                        type: Type.OBJECT,
                                        properties: {
                                            day: { type: Type.INTEGER, description: "Número do dia da atividade (contando desde o início da viagem)." },
                                            activity: { type: Type.STRING, description: "Descrição da atividade para aquele dia." },
                                        },
                                    },
                                },
                                transport_tips: { type: Type.STRING, description: "Dicas de como se locomover na cidade (transporte público, apps, etc.)." },
                                safety_tips: { type: Type.STRING, description: "Dicas de segurança específicas para o destino." },
                                food_recommendations: {
                                    type: Type.ARRAY,
                                    description: "Recomendações de pratos ou comidas típicas locais.",
                                    items: {
                                        type: Type.OBJECT,
                                        properties: {
                                            name: { type: Type.STRING, description: "Nome do prato ou comida." },
                                            description: { type: Type.STRING, description: "Breve descrição do prato." },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    costs: {
                        type: Type.OBJECT,
                        description: "Estimativa de custos detalhada em Reais (BRL), como números.",
                        properties: {
                            accommodation: { type: Type.NUMBER, description: "Custo total estimado com hospedagem." },
                            food: { type: Type.NUMBER, description: "Custo total estimado com alimentação." },
                            activities: { type: Type.NUMBER, description: "Custo total estimado com atividades e passeios." },
                            transport: { type: Type.NUMBER, description: "Custo total estimado com transporte local." },
                            total_without_flights: { type: Type.NUMBER, description: "Custo total estimado da viagem, excluindo voos internacionais/nacionais principais." },
                        },
                    },
                    checklist: {
                        type: Type.ARRAY,
                        description: "Checklist de planejamento",
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                task: { type: Type.STRING, description: "Tarefa do checklist" },
                                details: { type: Type.STRING, description: "Detalhes da tarefa" },
                            },
                        },
                    },
                     packing_list: {
                        type: Type.ARRAY,
                        description: "Lista de bagagem personalizada e categorizada com base nos destinos, clima e tipo de viagem.",
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                category: { type: Type.STRING, description: "Categoria dos itens (ex: 'Roupas', 'Documentos', 'Eletrônicos')." },
                                items: {
                                    type: Type.ARRAY,
                                    items: {
                                        type: Type.OBJECT,
                                        properties: {
                                            item: { type: Type.STRING, description: "O item a ser embalado." },
                                            quantity: { type: Type.INTEGER, description: "A quantidade sugerida." },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    flights: {
                        type: Type.ARRAY,
                        description: "Opções de voos, com no mínimo 30 opções",
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                airline: { type: Type.STRING, description: "Companhia aérea" },
                                stops: { type: Type.INTEGER, description: "Número de paradas como um número inteiro (ex: 0, 1, 2)" },
                                price: { type: Type.NUMBER, description: "Preço do voo em Reais (BRL) como um número, sem símbolos ou formatação (ex: 4500.50)" },
                                class: { type: Type.STRING, description: "Classe do voo" },
                            },
                        },
                    },
                    locations: {
                        type: Type.ARRAY,
                        description: "Lista de coordenadas geográficas para a origem e todos os destinos na ordem da viagem.",
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                city: { type: Type.STRING, description: "Nome da cidade" },
                                lat: { type: Type.NUMBER, description: "Latitude da cidade" },
                                lng: { type: Type.NUMBER, description: "Longitude da cidade" },
                            },
                            required: ['city', 'lat', 'lng']
                        }
                    },
                    weather: {
                        type: Type.ARRAY,
                        description: "Previsão do tempo para cada cidade de destino durante o período da viagem.",
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                destination: { type: Type.STRING, description: "Nome da cidade de destino." },
                                avg_temp_celsius: { type: Type.NUMBER, description: "Temperatura média em graus Celsius." },
                                forecast_summary: { type: Type.STRING, description: "Resumo da previsão (ex: 'Ensolarado com poucas nuvens', 'Chuva esparsa')." }
                            }
                        }
                    }
                },
            };

            const prompt = `Como Ernest, um agente de viagens experiente e amigável com um estilo de escrita de blog, crie um plano de viagem detalhado. Para CADA destino, forneça um roteiro completo.
- Previsão da viagem: ${tripDetails.prediction}
- Tipo: ${tripDetails.type}
- Tipo de Viagem: ${tripDetails.tripType}
- Origem: ${tripDetails.origin}
- Destinos: ${tripDetails.destinations.join(', ')}
- Passageiros: ${tripDetails.adults} adultos, ${tripDetails.children} crianças
- Período: de ${tripDetails.startDate} a ${tripDetails.endDate}
- Classe da Passagem: ${tripDetails.class}
- Incluir Stopover: ${tripDetails.stopover ? 'Sim' : 'Não'}

Para cada destino, inclua:
1.  Um resumo envolvente do destino.
2.  Um plano diário de atividades.
3.  Dicas úteis de transporte local.
4.  Dicas importantes de segurança.
5.  Recomendações da culinária local com nome e descrição dos pratos.

Adicionalmente, crie uma lista de bagagem ('packing_list') completa e categorizada, baseada nos destinos, clima e tipo de viagem.

Retorne um objeto JSON seguindo o schema fornecido. Todos os custos devem ser números em Reais Brasileiros (BRL), sem símbolos (ex: 3500.00). O número de paradas deve ser um inteiro (ex: 0). Inclua coordenadas geográficas para origem e destinos e a previsão do tempo.`;
            
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: schema,
                },
            });
            
            let responseText = response.text.trim();
            if (responseText.startsWith('```') && responseText.endsWith('```')) {
                const firstBrace = responseText.indexOf('{');
                const lastBrace = responseText.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace !== -1) {
                    responseText = responseText.substring(firstBrace, lastBrace + 1);
                }
            }

            try {
                const jsonResponse = JSON.parse(responseText);
                const planWithChecklistState: Plan = {
                    ...jsonResponse,
                    checklist: jsonResponse.checklist.map((item: any) => ({ ...item, completed: false })),
                    packing_list: jsonResponse.packing_list?.map((cat: any) => ({
                        ...cat,
                        items: cat.items.map((item: any) => ({ ...item, packed: false }))
                    })) || []
                };

                setPlan(planWithChecklistState);
                setActiveTab('roteiro');
                setCurrentItineraryPage(0);
                
                // Generate images after setting the plan
                generateDestinationImages(ai, planWithChecklistState.itinerary);

                const newHistoryItem: HistoryItem = {
                    id: new Date().toISOString(),
                    title: `${tripDetails.origin} → ${tripDetails.destinations.join(', ')}`,
                    details: { ...tripDetails }
                };

                setSearchHistory(prevHistory => {
                    const filteredHistory = prevHistory.filter(item => 
                        JSON.stringify(item.details) !== JSON.stringify(newHistoryItem.details)
                    );
                    const updatedHistory = [newHistoryItem, ...filteredHistory].slice(0, 5);
                    try {
                        localStorage.setItem('ernest-travel-history', JSON.stringify(updatedHistory));
                    } catch (e) {
                        console.error("Failed to save history to localStorage", e);
                    }
                    return updatedHistory;
                });

            } catch (parseError) {
                console.error("Failed to parse JSON response from AI:", parseError);
                console.error("Raw response text:", responseText);
                setError('A resposta da IA está em um formato inválido. Por favor, tente novamente.');
            }

        } catch (err) {
            console.error("Error generating plan:", err);
            setError('Desculpe, não foi possível gerar o plano de viagem. Por favor, tente novamente.');
        } finally {
            setLoading(false);
        }
    };

    const handleSavePlan = () => {
        if (plan) {
            try {
                const dataToSave = JSON.stringify({ plan, tripDetails, selectedFlight });
                localStorage.setItem('ernest-travel-plan', dataToSave);
                setIsSaved(true);
            } catch (err) {
                console.error("Failed to save plan to localStorage", err);
                setError('Não foi possível salvar o plano. O armazenamento local pode estar cheio.');
            }
        }
    };

    const downloadFile = (content: string, fileName: string, contentType: string) => {
        const a = document.createElement("a");
        const file = new Blob([content], { type: contentType });
        a.href = URL.createObjectURL(file);
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const handleDownloadChecklist = () => {
        if (!plan?.checklist) return;
        const content = plan.checklist.map(item => `[${item.completed ? 'x' : ' '}] ${item.task}\n- ${item.details}\n`).join('\n');
        downloadFile(content, 'checklist_viagem.txt', 'text/plain');
    };

    const handleDownloadFlights = () => {
        if (!filteredFlights) return;
        const headers = "Companhia Aérea,Paradas,Preço (BRL),Classe";
        const rows = filteredFlights.map(f => `"${f.airline}","${f.stops}","${f.price.toFixed(2)}","${f.class}"`);
        const csvContent = `${headers}\n${rows.join('\n')}`;
        downloadFile(csvContent, 'opcoes_voo.csv', 'text/csv;charset=utf-8;');
    };

    const formatCurrency = (value?: number) => {
        if (typeof value !== 'number') return 'N/A';
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    };

    const totalCostWithFlight = useMemo(() => {
        if (!plan?.costs) return 0;
        const baseCost = plan.costs.total_without_flights || 0;
        const flightCost = selectedFlight?.price || 0;
        return baseCost + flightCost;
    }, [plan?.costs, selectedFlight]);

    return (
        <>
            <header>
                <h1>Planejador de Viagens do Ernest</h1>
            </header>
            <div className="container">
                <main>
                    <section className="planner-form">
                        <h2>Crie o Roteiro da Sua Próxima Aventura</h2>
                        <div className="form-grid">
                            <div className="form-group">
                                <label htmlFor="prediction">Previsão da Viagem</label>
                                <input type="text" id="prediction" name="prediction" value={tripDetails.prediction} onChange={handleInputChange} placeholder="Ex: 2026" />
                            </div>
                            <div className="form-group">
                                <label>Opção da Viagem</label>
                                <div className="radio-group">
                                    <label><input type="radio" name="type" value="Nacional" checked={tripDetails.type === 'Nacional'} onChange={handleInputChange} /> Nacional</label>
                                    <label><input type="radio" name="type" value="Internacional" checked={tripDetails.type === 'Internacional'} onChange={handleInputChange} /> Internacional</label>
                                </div>
                            </div>
                            <div className="form-group">
                                <label htmlFor="origin">Origem</label>
                                <input type="text" id="origin" name="origin" value={tripDetails.origin} onChange={handleInputChange} />
                            </div>
                             <div className="form-group full-width">
                                <label htmlFor="destination">Destinos</label>
                                <div className="destinations-group">
                                    <input type="text" id="destination" value={currentDestination} onChange={(e) => setCurrentDestination(e.target.value)} placeholder="Adicione um destino"/>
                                    <button className="btn btn-sm" onClick={handleAddDestination} type="button">Adicionar</button>
                                </div>
                                <ul className="destinations-list">
                                    {tripDetails.destinations.map(dest => (
                                        <li key={dest} className="destination-tag">
                                            {dest} <button onClick={() => handleRemoveDestination(dest)}>&times;</button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                             <div className="form-group passengers-group">
                                <div>
                                    <label htmlFor="adults">Adultos</label>
                                    <input type="number" id="adults" name="adults" min="1" value={tripDetails.adults} onChange={handleInputChange} />
                                </div>
                                <div>
                                    <label htmlFor="children">Crianças</label>
                                    <input type="number" id="children" name="children" min="0" value={tripDetails.children} onChange={handleInputChange} />
                                </div>
                            </div>
                            <div className="form-group date-range-group">
                                <div>
                                    <label htmlFor="startDate">Data de Início</label>
                                    <input type="date" id="startDate" name="startDate" value={tripDetails.startDate} onChange={handleInputChange} />
                                </div>
                                <div>
                                    <label htmlFor="endDate">Data de Fim</label>
                                    <input type="date" id="endDate" name="endDate" value={tripDetails.endDate} onChange={handleInputChange} />
                                </div>
                            </div>
                            <div className="form-group">
                                <label htmlFor="tripType">Tipo de Viagem</label>
                                <select id="tripType" name="tripType" value={tripDetails.tripType} onChange={handleInputChange}>
                                    <option>Aventura</option>
                                    <option>Relaxante</option>
                                    <option>Cultural</option>
                                    <option>Gastronômica</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label htmlFor="class">Classe das Passagens</label>
                                <select id="class" name="class" value={tripDetails.class} onChange={handleInputChange}>
                                    <option>Econômica</option>
                                    <option>Executiva</option>
                                    <option>Primeira Classe</option>
                                </select>
                            </div>
                            <div className="form-group checkbox-group">
                                <input type="checkbox" id="stopover" name="stopover" checked={tripDetails.stopover} onChange={handleInputChange} />
                                <label htmlFor="stopover">Incluir busca por Stopover</label>
                            </div>
                        </div>
                        <button className="btn" onClick={generatePlan} disabled={loading}>
                            {loading ? 'Planejando...' : 'Planejar Viagem'}
                        </button>

                        {searchHistory.length > 0 && (
                            <div className="search-history">
                                <h3>Histórico de Pesquisas</h3>
                                <ul className="search-history-list">
                                    {searchHistory.map((item) => (
                                        <li 
                                            key={item.id} 
                                            className="search-history-item" 
                                            onClick={() => handleLoadHistoryItem(item.details)} 
                                            title="Recarregar esta pesquisa"
                                            tabIndex={0}
                                            onKeyDown={(e) => { if (e.key === 'Enter') handleLoadHistoryItem(item.details) }}
                                        >
                                            <span>{item.title}</span>
                                            <span>{item.details.destinations.length} destino(s)</span>
                                        </li>
                                    ))}
                                </ul>
                                <button className="btn-clear-history" onClick={handleClearHistory}>
                                    Limpar Histórico
                                </button>
                            </div>
                        )}
                    </section>
                    <section className="results-display">
                        {loading && <div className="loading-spinner"></div>}
                        {error && <p className="error-message">{error}</p>}
                        {!loading && !plan && !error && (
                             <div className="results-placeholder">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.25-6.362m-16.5 0A9.004 9.004 0 0112 3c1.356 0 2.64.31 3.805.872m-7.61 14.128A9.004 9.004 0 0112 21c-1.356 0-2.64-.31-3.805-.872m7.61-14.128L12 12.75m-4.5-4.5L12 12.75m0 0l4.5 4.5m-4.5-4.5L7.5 17.25" />
                                </svg>
                                <h3>Seu guia de viagem personalizado aparecerá aqui.</h3>
                                <p>Preencha os detalhes ao lado para começar a planejar sua próxima aventura!</p>
                            </div>
                        )}
                        {plan && (
                            <div className="results-content">
                                <div className="result-card">
                                    <h3>
                                        Resumo da Viagem
                                        <button className="save-btn" onClick={handleSavePlan} disabled={isSaved}>
                                            {isSaved ? 'Plano Salvo!' : 'Salvar Plano'}
                                        </button>
                                    </h3>
                                    <p><strong>Rota:</strong> {tripDetails.origin} → {tripDetails.destinations.join(' → ')} → {tripDetails.origin}</p>
                                    <p><strong>Custo Total Estimado (com voo):</strong> <span className="total-cost">{formatCurrency(totalCostWithFlight)}</span></p>
                                </div>

                                <div className="tabs">
                                    <button className={`tab-item ${activeTab === 'roteiro' ? 'active' : ''}`} onClick={() => setActiveTab('roteiro')}>Roteiro</button>
                                    <button className={`tab-item ${activeTab === 'bagagem' ? 'active' : ''}`} onClick={() => setActiveTab('bagagem')}>O que levar</button>
                                    <button className={`tab-item ${activeTab === 'orcamento' ? 'active' : ''}`} onClick={() => setActiveTab('orcamento')}>Orçamento</button>
                                    <button className={`tab-item ${activeTab === 'checklist' ? 'active' : ''}`} onClick={() => setActiveTab('checklist')}>Checklist</button>
                                    <button className={`tab-item ${activeTab === 'clima' ? 'active' : ''}`} onClick={() => setActiveTab('clima')}>Previsão do Tempo</button>
                                    <button className={`tab-item ${activeTab === 'voos' ? 'active' : ''}`} onClick={() => setActiveTab('voos')}>Opções de Voo</button>
                                    <button className={`tab-item ${activeTab === 'mapa' ? 'active' : ''}`} onClick={() => setActiveTab('mapa')}>Mapa da Rota</button>
                                </div>
                                
                                <div className="tab-content">
                                    {activeTab === 'roteiro' && plan.itinerary && plan.itinerary.length > 0 && (
                                        <div className="result-card">
                                            {(() => {
                                                const currentItinerary = plan.itinerary[currentItineraryPage];
                                                if (!currentItinerary) return <p>Roteiro indisponível.</p>;
                                                return (
                                                    <>
                                                        <h3>Roteiro para: {currentItinerary.destination_name}</h3>
                                                         <div className="destination-image-container">
                                                            {currentItinerary.imageUrl === 'loading' && (
                                                                <div className="image-loading-placeholder">
                                                                    <div className="loading-spinner"></div>
                                                                    <p>Gerando imagem...</p>
                                                                </div>
                                                            )}
                                                            {currentItinerary.imageUrl && currentItinerary.imageUrl.startsWith('data:') && (
                                                                <img src={currentItinerary.imageUrl} alt={`Imagem de ${currentItinerary.destination_name}`} className="destination-image" />
                                                            )}
                                                        </div>
                                                        <p>{currentItinerary.destination_summary}</p>
                                                        
                                                        <div className="itinerary-section">
                                                            <h4>Plano Diário</h4>
                                                            {currentItinerary.daily_plan.map(item => (
                                                                <div key={`${item.day}-${item.activity}`} className="checklist-item">
                                                                    <strong>Dia {item.day}</strong>
                                                                    <p>{item.activity}</p>
                                                                </div>
                                                            ))}
                                                        </div>

                                                        <div className="itinerary-section tips-grid">
                                                           <div className="tip-card">
                                                                <h4>✈️ Transporte</h4>
                                                                <p>{currentItinerary.transport_tips}</p>
                                                           </div>
                                                           <div className="tip-card">
                                                                <h4>🛡️ Segurança</h4>
                                                                <p>{currentItinerary.safety_tips}</p>
                                                           </div>
                                                        </div>

                                                        <div className="itinerary-section">
                                                            <h4>Culinária Local 🍽️</h4>
                                                             <ul className="food-list">
                                                                {currentItinerary.food_recommendations.map(food => (
                                                                    <li key={food.name}>
                                                                        <strong>{food.name}:</strong> {food.description}
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        </div>
                                                    </>
                                                );
                                            })()}
                                            
                                            <div className="itinerary-pagination">
                                                <button 
                                                    onClick={() => setCurrentItineraryPage(p => p - 1)} 
                                                    disabled={currentItineraryPage === 0}
                                                    className="pagination-btn"
                                                >
                                                    &larr; Anterior
                                                </button>
                                                <span>{currentItineraryPage + 1} de {plan.itinerary.length}</span>
                                                <button 
                                                    onClick={() => setCurrentItineraryPage(p => p + 1)} 
                                                    disabled={currentItineraryPage === plan.itinerary.length - 1}
                                                    className="pagination-btn"
                                                >
                                                    Próximo &rarr;
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {activeTab === 'bagagem' && (
                                        <div className="result-card">
                                            <h3>O que levar na sua viagem</h3>
                                            <div className="packing-list-container">
                                                {plan.packing_list?.map((category, catIndex) => (
                                                    <div key={category.category} className="packing-category">
                                                        <h4>{category.category}</h4>
                                                        <ul className="packing-items-list">
                                                            {category.items.map((item, itemIndex) => (
                                                                <li key={item.item} className={`packing-item ${item.packed ? 'packed' : ''}`}>
                                                                     <input 
                                                                        type="checkbox" 
                                                                        id={`pack-${catIndex}-${itemIndex}`} 
                                                                        checked={item.packed} 
                                                                        onChange={() => handlePackingListToggle(catIndex, itemIndex)} 
                                                                    />
                                                                    <label htmlFor={`pack-${catIndex}-${itemIndex}`}>
                                                                        {item.item} {item.quantity > 1 ? `(x${item.quantity})` : ''}
                                                                    </label>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {activeTab === 'orcamento' && (
                                        <div className="result-card">
                                            <h3>Detalhamento do Orçamento</h3>
                                            <div className="budget-summary">
                                                <div className="budget-item"><span>Hospedagem</span> <span>{formatCurrency(plan.costs.accommodation)}</span></div>
                                                <div className="budget-item"><span>Alimentação</span> <span>{formatCurrency(plan.costs.food)}</span></div>
                                                <div className="budget-item"><span>Atividades</span> <span>{formatCurrency(plan.costs.activities)}</span></div>
                                                <div className="budget-item"><span>Transporte Local</span> <span>{formatCurrency(plan.costs.transport)}</span></div>
                                                <div className="budget-item"><span>Voo Selecionado</span> <span>{formatCurrency(selectedFlight?.price)}</span></div>
                                                <div className="budget-item total"><span>Custo Total Estimado</span> <span>{formatCurrency(totalCostWithFlight)}</span></div>
                                            </div>
                                            <h4>Distribuição de Custos</h4>
                                            <div className="budget-chart">
                                                {Object.entries({
                                                    'Hospedagem': plan.costs.accommodation,
                                                    'Alimentação': plan.costs.food,
                                                    'Atividades': plan.costs.activities,
                                                    'Transporte': plan.costs.transport,
                                                    'Voo': selectedFlight?.price || 0,
                                                }).map(([key, value]) => {
                                                    if (value <= 0) return null;
                                                    const percentage = totalCostWithFlight > 0 ? (value / totalCostWithFlight) * 100 : 0;
                                                    return (
                                                        <div key={key} className="chart-item">
                                                            <div className="chart-label">{key}</div>
                                                            <div className="chart-bar-container">
                                                                <div className="chart-bar" style={{ width: `${percentage}%` }}>
                                                                    {formatCurrency(value)}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {activeTab === 'checklist' && (
                                        <div className="result-card">
                                            <h3>
                                                Checklist de Planejamento
                                                <button className="download-btn" onClick={handleDownloadChecklist}>Baixar Checklist</button>
                                            </h3>
                                            {plan.checklist.map((item, index) => (
                                                <div key={item.task} className={`checklist-item interactive ${item.completed ? 'completed' : ''}`}>
                                                    <input 
                                                        type="checkbox" 
                                                        id={`task-${index}`} 
                                                        checked={item.completed} 
                                                        onChange={() => handleChecklistToggle(index)} 
                                                    />
                                                    <label htmlFor={`task-${index}`}>
                                                        <strong>{item.task}</strong>
                                                        <p>{item.details}</p>
                                                    </label>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    
                                    {activeTab === 'clima' && (
                                        <div className="result-card">
                                            <h3>Previsão do Tempo para os Destinos</h3>
                                            <div className="weather-grid">
                                                {plan.weather?.map((w, index) => (
                                                    <div key={index} className="weather-card">
                                                        <div className="weather-icon">{getWeatherIcon(w.forecast_summary)}</div>
                                                        <h4>{w.destination}</h4>
                                                        <p className="weather-temp">{Math.round(w.avg_temp_celsius)}°C</p>
                                                        <p>{w.forecast_summary}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {activeTab === 'voos' && (
                                        <div className="result-card">
                                            <h3>
                                                Opções de Voo Encontradas
                                                <button className="download-btn" onClick={handleDownloadFlights}>Baixar CSV</button>
                                            </h3>
                                            <div className="filters-container">
                                                <div className="filter-group">
                                                    <label htmlFor="airline">Companhia Aérea</label>
                                                    <select name="airline" id="airline" value={filters.airline} onChange={handleFilterChange}>
                                                        <option value="all">Todas</option>
                                                        {airlines.map(name => <option key={name} value={name}>{name}</option>)}
                                                    </select>
                                                </div>
                                                <div className="filter-group">
                                                    <label htmlFor="stops">Paradas</label>
                                                    <select name="stops" id="stops" value={filters.stops} onChange={handleFilterChange}>
                                                        <option value="all">Qualquer</option>
                                                        <option value="0">Direto</option>
                                                        <option value="1">1 Parada</option>
                                                        <option value="2">2+ Paradas</option>
                                                    </select>
                                                </div>
                                                <div className="filter-group">
                                                    <label htmlFor="maxPrice">Preço Máximo (R$)</label>
                                                    <input type="number" name="maxPrice" id="maxPrice" value={filters.maxPrice} onChange={handleFilterChange} placeholder="Ex: 5000" />
                                                </div>
                                            </div>
                                            <table className="flights-table">
                                                <thead>
                                                    <tr>
                                                        <th>Companhia Aérea</th>
                                                        <th>Paradas</th>
                                                        <th>Preço (Estimado)</th>
                                                        <th>Classe</th>
                                                        <th>Ação</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {displayedFlights.map((flight, index) => {
                                                        const isSelected = selectedFlight && JSON.stringify(selectedFlight) === JSON.stringify(flight);
                                                        const flightRow = (
                                                            <tr key={index} className={isSelected ? 'selected' : ''}>
                                                                <td>
                                                                <a href={`https://www.google.com/search?q=${encodeURIComponent('flights from ' + tripDetails.origin + ' to ' + tripDetails.destinations[0] + ' with ' + flight.airline)}`} target="_blank" rel="noopener noreferrer">
                                                                        {flight.airline}
                                                                    </a>
                                                                </td>
                                                                <td>{flight.stops === 0 ? 'Direto' : `${flight.stops} parada(s)`}</td>
                                                                <td>{formatCurrency(flight.price)}</td>
                                                                <td>{flight.class}</td>
                                                                <td>
                                                                    <button onClick={() => handleSelectFlight(flight)} className="btn-select-flight">
                                                                        {isSelected ? 'Selecionado' : 'Selecionar'}
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        );

                                                        if (displayedFlights.length === index + 1) {
                                                            return (
                                                                <tr ref={lastFlightElementRef} key={`last-${index}`} className={isSelected ? 'selected' : ''}>
                                                                    <td>
                                                                        <a href={`https://www.google.com/search?q=${encodeURIComponent('flights from ' + tripDetails.origin + ' to ' + tripDetails.destinations[0] + ' with ' + flight.airline)}`} target="_blank" rel="noopener noreferrer">
                                                                            {flight.airline}
                                                                        </a>
                                                                    </td>
                                                                    <td>{flight.stops === 0 ? 'Direto' : `${flight.stops} parada(s)`}</td>
                                                                    <td>{formatCurrency(flight.price)}</td>
                                                                    <td>{flight.class}</td>
                                                                    <td>
                                                                        <button onClick={() => handleSelectFlight(flight)} className="btn-select-flight">
                                                                            {isSelected ? 'Selecionado' : 'Selecionar'}
                                                                        </button>
                                                                    </td>
                                                                </tr>
                                                            )
                                                        }
                                                        return flightRow;
                                                    })}
                                                </tbody>
                                            </table>
                                            {isLoadingMore && <p className="loading-more">Carregando mais voos...</p>}
                                            {!isLoadingMore && displayedFlights.length === 0 && <p className="loading-more">Nenhum voo encontrado com os filtros selecionados.</p>}
                                        </div>
                                    )}

                                    {activeTab === 'mapa' && plan.locations && plan.locations.length > 1 && (
                                        <div className="result-card route-map">
                                            <h3>Visualização da Rota</h3>
                                            <MapContainer 
                                                bounds={plan.locations.map(loc => [loc.lat, loc.lng])} 
                                                scrollWheelZoom={false} 
                                                style={{ height: '400px', width: '100%', borderRadius: '8px' }}
                                                key={plan.locations.map(l => l.city).join('-')}
                                            >
                                                <TileLayer
                                                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                                />
                                                {plan.locations.map((loc, index) => (
                                                    <Marker key={index} position={[loc.lat, loc.lng]}>
                                                        <Popup>{loc.city}</Popup>
                                                    </Marker>
                                                ))}
                                                <Polyline 
                                                    positions={plan.locations.map(loc => [loc.lat, loc.lng])}
                                                    color="#005a9e"
                                                />
                                                <ResizeMap bounds={plan.locations.map(loc => [loc.lat, loc.lng]) as [number, number][]} />
                                            </MapContainer>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </section>
                </main>
            </div>
        </>
    );
};

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);

    const initializeApp = () => {
        let apiKey = sessionStorage.getItem('gemini_api_key');
        if (!apiKey) {
            apiKey = prompt("Por favor, insira sua Chave de API (API Key) do Google AI Studio:", "");
            if (apiKey) {
                sessionStorage.setItem('gemini_api_key', apiKey);
            }
        }

        if (apiKey) {
            root.render(<App />);
        } else {
            root.render(
                <>
                    <header>
                        <h1>Planejador de Viagens do Ernest</h1>
                    </header>
                    <div className="container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '4rem' }}>
                        <div className="error-message" style={{textAlign: 'center', maxWidth: '600px'}}>
                            <h2>Chave de API Necessária</h2>
                            <p>Uma Chave de API (API Key) do Google AI Studio é necessária para usar esta aplicação.<br/>Por favor, atualize a página para inserir sua chave.</p>
                        </div>
                    </div>
                </>
            );
        }
    };

    initializeApp();
}
