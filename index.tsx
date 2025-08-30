import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';

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

interface Plan {
    itinerary: {
        title: string;
        daily_summary: string;
        suggested_activities: {
            day: number;
            activity: string;
        }[];
    };
    costs: {
        estimated_daily: string;
        estimated_total: string;
    };
    checklist: {
        task: string;
        details: string;
    }[];
    flights: Flight[];
    locations: Location[];
}

const ApiKeyMissingScreen = () => (
    <>
        <header>
            <h1>Planejador de Viagens do Ernest</h1>
        </header>
        <div className="container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '4rem' }}>
            <div className="error-message" style={{textAlign: 'center', maxWidth: '600px'}}>
                <h2>Chave de API não configurada</h2>
                <p>A chave de API do Google AI Studio não foi encontrada.<br/>Por favor, configure a variável de ambiente <strong>API_KEY</strong> para usar a aplicação.</p>
            </div>
        </div>
    </>
);

const App = () => {
    const [tripDetails, setTripDetails] = useState({
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
                const { plan: savedPlan, tripDetails: savedTripDetails }: { plan: Plan, tripDetails: any } = JSON.parse(savedPlanData);
                if (savedPlan && savedTripDetails) {
                    setPlan(savedPlan);
                    setTripDetails(savedTripDetails);
                    setIsSaved(true);
                }
            }
        } catch (err) {
            console.error("Failed to load or parse saved plan from localStorage", err);
            localStorage.removeItem('ernest-travel-plan');
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

    const generatePlan = async () => {
        if (!process.env.API_KEY) {
            setError('A chave de API não está configurada. Por favor, configure a variável de ambiente API_KEY.');
            return;
        }

        setLoading(true);
        setError('');
        setPlan(null);
        setIsSaved(false);

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
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            const schema = {
                type: Type.OBJECT,
                properties: {
                    itinerary: {
                        type: Type.OBJECT,
                        properties: {
                            title: { type: Type.STRING, description: "Título do roteiro" },
                            daily_summary: { type: Type.STRING, description: "Resumo diário da viagem" },
                            suggested_activities: {
                                type: Type.ARRAY,
                                description: "Lista de atividades sugeridas",
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        day: { type: Type.INTEGER, description: "Dia da atividade" },
                                        activity: { type: Type.STRING, description: "Descrição da atividade" },
                                    },
                                },
                            },
                        },
                    },
                    costs: {
                        type: Type.OBJECT,
                        properties: {
                            estimated_daily: { type: Type.STRING, description: "Custo diário estimado em Reais (BRL)" },
                            estimated_total: { type: Type.STRING, description: "Custo total estimado em Reais (BRL)" },
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
                    }
                },
            };

            const prompt = `Como Ernest, um agente de viagens experiente, crie um plano de viagem detalhado com base nas seguintes informações. A resposta deve ser amigável e útil.
            - Previsão da viagem: ${tripDetails.prediction}
            - Tipo: ${tripDetails.type}
            - Tipo de Viagem: ${tripDetails.tripType}
            - Origem: ${tripDetails.origin}
            - Destinos: ${tripDetails.destinations.join(', ')}
            - Passageiros: ${tripDetails.adults} adultos, ${tripDetails.children} crianças
            - Período: de ${tripDetails.startDate} a ${tripDetails.endDate}
            - Classe da Passagem: ${tripDetails.class}
            - Incluir Stopover: ${tripDetails.stopover ? 'Sim' : 'Não'}
            
            Retorne um objeto JSON seguindo o schema fornecido. O preço do voo deve ser um número em Reais Brasileiros (BRL), sem símbolos de moeda ou separadores de milhar (ex: 3500.00). O número de paradas deve ser um número inteiro (ex: 0 para direto). Inclua as coordenadas geográficas (latitude e longitude) para a cidade de origem e cada um dos destinos em ordem de viagem. Seja criativo e realista nas sugestões, personalizando o roteiro com base no tipo de viagem.`;
            
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
                const jsonResponse: Plan = JSON.parse(responseText);
                setPlan(jsonResponse);
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
                const dataToSave = JSON.stringify({ plan, tripDetails });
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
        const content = plan.checklist.map(item => `${item.task}\n- ${item.details}\n`).join('\n');
        downloadFile(content, 'checklist_viagem.txt', 'text/plain');
    };

    const handleDownloadFlights = () => {
        if (!filteredFlights) return;
        const headers = "Companhia Aérea,Paradas,Preço (BRL),Classe";
        const rows = filteredFlights.map(f => `"${f.airline}","${f.stops}","${f.price.toFixed(2)}","${f.class}"`);
        const csvContent = `${headers}\n${rows.join('\n')}`;
        downloadFile(csvContent, 'opcoes_voo.csv', 'text/csv;charset=utf-8;');
    };

    return (
        <>
            <header>
                <h1>Planejador de Viagens do Ernest</h1>
            </header>
            <div className="container">
                <main>
                    <aside className="planner-form">
                        <h2>Crie o Roteiro da Sua Próxima Aventura</h2>
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
                        <div className="form-group">
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
                        <button className="btn" onClick={generatePlan} disabled={loading}>
                            {loading ? 'Planejando...' : 'Planejar Viagem'}
                        </button>
                    </aside>
                    <section className="results-display">
                        {loading && <div className="loading-spinner"></div>}
                        {error && <p className="error-message">{error}</p>}
                        {!loading && !plan && !error && (
                             <div className="results-placeholder">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.25-6.362m-16.5 0A9.004 9.004 0 0112 3c1.356 0 2.64d.31 3.805.872m-7.61 14.128A9.004 9.004 0 0112 21c-1.356 0-2.64-.31-3.805-.872m7.61-14.128L12 12.75m-4.5-4.5L12 12.75m0 0l4.5 4.5m-4.5-4.5L7.5 17.25" />
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
                                    <p><strong>Custo Diário Estimado:</strong> {plan.costs.estimated_daily}</p>
                                    <p><strong>Custo Total Estimado (sem voos):</strong> {plan.costs.estimated_total}</p>
                                </div>

                                {plan.locations && plan.locations.length > 1 && (
                                    <div className="result-card route-map">
                                        <h3>Visualização da Rota</h3>
                                        <MapContainer 
                                            bounds={plan.locations.map(loc => [loc.lat, loc.lng])} 
                                            scrollWheelZoom={false} 
                                            style={{ height: '400px', width: '100%', borderRadius: '8px' }}
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
                                        </MapContainer>
                                    </div>
                                )}

                                <div className="result-card">
                                    <h3>{plan.itinerary.title}</h3>
                                    <p>{plan.itinerary.daily_summary}</p>
                                    <br/>
                                    {plan.itinerary.suggested_activities.map(item => (
                                        <div key={item.day} className="checklist-item">
                                            <strong>Dia {item.day}</strong>
                                            <p>{item.activity}</p>
                                        </div>
                                    ))}
                                </div>
                                
                                <div className="result-card">
                                    <h3>
                                        Checklist de Planejamento
                                        <button className="download-btn" onClick={handleDownloadChecklist}>Baixar Checklist</button>
                                    </h3>
                                    {plan.checklist.map(item => (
                                        <div key={item.task} className="checklist-item">
                                            <strong>{item.task}</strong>
                                            <p>{item.details}</p>
                                        </div>
                                    ))}
                                </div>

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
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {displayedFlights.map((flight, index) => {
                                                const flightRow = (
                                                    <tr key={index}>
                                                        <td>
                                                           <a href={`https://www.google.com/search?q=${encodeURIComponent('flights from ' + tripDetails.origin + ' to ' + tripDetails.destinations[0] + ' with ' + flight.airline)}`} target="_blank" rel="noopener noreferrer">
                                                                {flight.airline}
                                                            </a>
                                                        </td>
                                                        <td>{flight.stops === 0 ? 'Direto' : `${flight.stops} parada(s)`}</td>
                                                        <td>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(flight.price)}</td>
                                                        <td>{flight.class}</td>
                                                    </tr>
                                                );

                                                if (displayedFlights.length === index + 1) {
                                                     return (
                                                        <tr ref={lastFlightElementRef} key={`last-${index}`}>
                                                             <td>
                                                                <a href={`https://www.google.com/search?q=${encodeURIComponent('flights from ' + tripDetails.origin + ' to ' + tripDetails.destinations[0] + ' with ' + flight.airline)}`} target="_blank" rel="noopener noreferrer">
                                                                    {flight.airline}
                                                                </a>
                                                            </td>
                                                            <td>{flight.stops === 0 ? 'Direto' : `${flight.stops} parada(s)`}</td>
                                                            <td>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(flight.price)}</td>
                                                            <td>{flight.class}</td>
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
    if (process.env.API_KEY) {
        root.render(<App />);
    } else {
        root.render(<ApiKeyMissingScreen />);
    }
}
