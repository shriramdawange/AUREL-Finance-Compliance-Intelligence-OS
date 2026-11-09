import { useEffect, useMemo, useState, type ComponentType, type FormEvent, type ReactNode } from "react";
import {
  Activity, AlertCircle, AlertTriangle, ArrowDownLeft, ArrowDownRight, ArrowLeftRight, ArrowRight,
  ArrowUpRight, BadgeCheck, Banknote, Bell, BookOpen, BriefcaseBusiness, Building2, CalendarDays,
  Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, Command,
  Download, FileCheck2, FileClock, FileImage, FileSpreadsheet, FileText, Filter, FolderArchive,
  Gauge, GitCompareArrows, Grid2X2, HandCoins, Headphones, Inbox, Landmark, LayoutDashboard,
  LifeBuoy, ListChecks, LockKeyhole, Menu, MoreHorizontal, PanelLeftClose, Paperclip, Plus,
  Receipt, ReceiptText, RefreshCw, Search, Send, Settings, ShieldCheck, Sparkles, Upload,
  UserRound, Users, Wallet, X, Zap
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis
} from "recharts";
import { inr, rupees, validateJournal, mask } from "./lib/money";
import { hashHexToUuid, parseBankStatementDate, parseCsv, parseRupeeMinor, sha256Hex } from "./lib/csv";
import { useAurelSession } from "./components/AuthGate";

type Client = { id: string; name: string; type: string; gstin: string; state: string; turnover: number; status: string; owner: string; tasks: number };
type Transaction = { id: string; date: string; party: string; description: string; direction: "in" | "out"; gross: number; fee: number; category: string; source: string; status: string };
type DocumentItem = { id: string; name: string; party: string; kind: string; date: string; amount: number; confidence: number; status: string };
type ReconItem = { id: string; date: string; description: string; statement: number; book: number; status: string };
type Task = { id: string; title: string; client: string; due: string; assignee: string; priority: string; status: string };

const navGroups: { label: string; items: [string, string, ComponentType<any>][] }[] = [
  { label: "WORKSPACE", items: [
    ["Clients & Entities","clients",Building2],["Document Inbox","documents",Inbox],["Transactions","transactions",ArrowLeftRight],
    ["Sales & Purchases","sales-purchases",ReceiptText],["Banking","banking",Landmark],["Payables & Receivables","payables-receivables",Wallet]
  ]},
  { label: "ACCOUNTING", items: [
    ["General Ledger","ledger",BookOpen],["Journal Entries","journals",FileSpreadsheet],["Trial Balance","trial-balance",Grid2X2],
    ["Profit & Loss","profit-loss",Activity],["Balance Sheet","balance-sheet",BriefcaseBusiness],["Cash Flow","cash-flow",ArrowDownLeft],["Reconciliation","reconciliation",GitCompareArrows]
  ]},
  { label: "TAX & COMPLIANCE", items: [
    ["GST Workbench","gst",FileCheck2],["ITC Reconciliation","itc",ShieldCheck],["TDS / TCS","tds",PercentIcon],["Income Tax","income-tax",Receipt],
    ["Compliance Calendar","compliance",CalendarDays],["Notices","notices",AlertCircle]
  ]},
  { label: "INTELLIGENCE", items: [
    ["Business Insights","insights",Gauge],["Forecasts","forecasts",Activity],["Anomalies","anomalies",AlertTriangle],["Reports","reports",FileText]
  ]},
  { label: "OPERATIONS", items: [
    ["Tasks & Approvals","tasks",ListChecks],["Audit Trail","audit",ShieldCheck],["Archive","archive",FolderArchive]
  ]},
  { label: "ADMIN", items: [
    ["Integrations","integrations",Zap],["Team & Permissions","team",Users],["Settings","settings",Settings]
  ]}
];
function PercentIcon(props: any) { return <span className="percent-icon" {...props}>%</span>; }

const initialClients: Client[] = [
  { id:"CL-001",name:"Kaveri Textiles Pvt. Ltd.",type:"Private Limited",gstin:"27AABCK1234F1Z5",state:"Maharashtra",turnover:rupees(42850000),status:"Active",owner:"Priya Nair",tasks:4 },
  { id:"CL-002",name:"Northstar Components",type:"Partnership",gstin:"27AAFCN9822E1Z2",state:"Maharashtra",turnover:rupees(18600000),status:"Active",owner:"Rahul Iyer",tasks:2 },
  { id:"CL-003",name:"Lotus Retail House",type:"Proprietorship",gstin:"27AARPL2214K1Z6",state:"Maharashtra",turnover:rupees(9250000),status:"Review",owner:"Priya Nair",tasks:5 },
  { id:"CL-004",name:"Coastal Agro Foods LLP",type:"LLP",gstin:"29AABFC4412P1Z8",state:"Karnataka",turnover:rupees(31200000),status:"Onboarding",owner:"Arjun Mehta",tasks:7 },
  { id:"CL-005",name:"Meridian Cloud Services",type:"Private Limited",gstin:"27AAECM6118C1Z4",state:"Maharashtra",turnover:rupees(12400000),status:"Active",owner:"Rahul Iyer",tasks:1 },
  { id:"CL-006",name:"Aarav Engineering Works",type:"Proprietorship",gstin:"27ABCPM7721N1Z1",state:"Maharashtra",turnover:rupees(7100000),status:"Active",owner:"Priya Nair",tasks:3 }
];
const initialTransactions: Transaction[] = [
  {id:"TX-8421",date:"09 Nov 2026",party:"Lotus Retail House",description:"Customer settlement · PayPal capture",direction:"in",gross:rupees(485000),fee:rupees(11165),category:"Customer receipts",source:"PayPal · Sandbox demo",status:"Reconciled"},
  {id:"TX-8420",date:"09 Nov 2026",party:"AWS India",description:"Cloud hosting · monthly usage",direction:"out",gross:rupees(24800),fee:0,category:"Technology",source:"HDFC Bank CSV",status:"Matched"},
  {id:"TX-8419",date:"08 Nov 2026",party:"Surat Yarn House",description:"Purchase bill PY-2291 settlement",direction:"out",gross:rupees(186400),fee:0,category:"Raw materials",source:"HDFC Bank CSV",status:"Matched"},
  {id:"TX-8418",date:"08 Nov 2026",party:"Kaveri Textiles",description:"Owner capital contribution",direction:"in",gross:rupees(500000),fee:0,category:"Capital",source:"Manual",status:"Excluded"},
  {id:"TX-8417",date:"07 Nov 2026",party:"MSEDCL",description:"Electricity bill · Oct 2026",direction:"out",gross:rupees(42650),fee:0,category:"Utilities",source:"HDFC Bank CSV",status:"Needs review"},
  {id:"TX-8416",date:"07 Nov 2026",party:"Northstar Components",description:"Invoice NS-778 customer receipt",direction:"in",gross:rupees(312000),fee:0,category:"Customer receipts",source:"ICICI Bank CSV",status:"Matched"},
  {id:"TX-8415",date:"06 Nov 2026",party:"Payroll batch",description:"October salary disbursement",direction:"out",gross:rupees(825000),fee:0,category:"People",source:"HDFC Bank CSV",status:"Matched"},
  {id:"TX-8414",date:"05 Nov 2026",party:"PayPal",description:"Processor fee · October settlement",direction:"out",gross:rupees(11165),fee:0,category:"Payment fees",source:"PayPal · Sandbox demo",status:"Reconciled"}
];
const initialDocs: DocumentItem[] = [
  {id:"DOC-184",name:"CN-088_Lotus_Retail.pdf",party:"Lotus Retail House",kind:"Credit note",date:"09 Nov 2026",amount:rupees(48500),confidence:79,status:"Needs review"},
  {id:"DOC-183",name:"INV-SUR-2291.pdf",party:"Surat Yarn House",kind:"Purchase invoice",date:"08 Nov 2026",amount:rupees(186400),confidence:98,status:"Approved"},
  {id:"DOC-182",name:"HDFC_Oct_Statement.csv",party:"HDFC Bank",kind:"Bank statement",date:"07 Nov 2026",amount:0,confidence:100,status:"Processed"},
  {id:"DOC-181",name:"MSEDCL_Oct_Bill.jpg",party:"MSEDCL",kind:"Expense bill",date:"07 Nov 2026",amount:rupees(42650),confidence:94,status:"Approved"},
  {id:"DOC-180",name:"ASMT-10_intimation.pdf",party:"GST Department",kind:"Notice",date:"06 Nov 2026",amount:rupees(125000),confidence:88,status:"Needs review"}
];
const initialRecon: ReconItem[] = [
  {id:"BNK-0441",date:"09 Nov",description:"AWS INDIA · recurring debit",statement:rupees(24800),book:rupees(24800),status:"Matched"},
  {id:"BNK-0440",date:"08 Nov",description:"SURAT YARN HOUSE · PY-2291",statement:rupees(186400),book:rupees(186400),status:"Matched"},
  {id:"BNK-0439",date:"07 Nov",description:"MSEDCL · ELEC BILL",statement:rupees(43150),book:rupees(42650),status:"Amount mismatch"},
  {id:"BNK-0438",date:"07 Nov",description:"NEFT NORTHSTAR COMPONENTS",statement:rupees(312000),book:rupees(312000),status:"Suggested"},
  {id:"BNK-0437",date:"06 Nov",description:"UNKNOWN UPI / 4491",statement:rupees(8750),book:0,status:"Missing in books"}
];
const initialTasks: Task[] = [
  {id:"T-091",title:"Resolve 7 ITC exceptions for October",client:"Kaveri Textiles",due:"12 Nov",assignee:"Priya Nair",priority:"High",status:"In progress"},
  {id:"T-090",title:"Review GST purchase register",client:"Lotus Retail House",due:"11 Nov",assignee:"Rahul Iyer",priority:"High",status:"Awaiting review"},
  {id:"T-089",title:"Collect partnership deed",client:"Coastal Agro Foods",due:"14 Nov",assignee:"Arjun Mehta",priority:"Medium",status:"Blocked"},
  {id:"T-088",title:"Generate monthly MIS pack",client:"Meridian Cloud",due:"15 Nov",assignee:"Rahul Iyer",priority:"Low",status:"To do"}
];
const cashSeries = [
  {period:"May",inflow:24.2,outflow:15.1},{period:"Jun",inflow:26.8,outflow:16.2},{period:"Jul",inflow:28.6,outflow:18.4},
  {period:"Aug",inflow:31.4,outflow:19.1},{period:"Sep",inflow:34.7,outflow:20.5},{period:"Oct",inflow:42.8,outflow:18.6}
];
const spendSeries = [
  {name:"People",value:8.25,color:"#1f7560"},{name:"Raw materials",value:5.62,color:"#73a997"},
  {name:"Technology",value:1.84,color:"#9bbcaf"},{name:"Operations",value:1.32,color:"#c7d6ce"},
  {name:"Other",value:1.57,color:"#d9ded8"}
];
const navTitle = (path: string) => navGroups.flatMap((g) => g.items).find((i) => i[1] === path)?.[0] || "Overview";
const compact = (p: number) => inr(p, true);
const dateNow = "09 Nov 2026";

function App() {
  const { client: dbClient, userId, organizationId, organizationName, isAuthenticated } = useAurelSession();
  const [section,setSection] = useState(() => location.hash.replace("#/","") || "overview");
  const [clients,setClients] = useState(initialClients);
  const [transactions,setTransactions] = useState(initialTransactions);
  const [documents,setDocuments] = useState(initialDocs);
  const [recon,setRecon] = useState(initialRecon);
  const [tasks,setTasks] = useState(initialTasks);
  const [journalEntries,setJournalEntries] = useState<any[]>([]);
  const [bankStatementLines,setBankStatementLines] = useState<any[]>([]);
  const [assistantOpen,setAssistantOpen] = useState(false);
  const [mobileOpen,setMobileOpen] = useState(false);
  const [modal,setModal] = useState("");
  const [toast,setToast] = useState("");
  const [search,setSearch] = useState("");
  const [period,setPeriod] = useState("Oct 2026");
  const [selected,setSelected] = useState<any>(null);
  const [chat,setChat] = useState<{role:string;text:string;source?:string}[]>([
    {role:"assistant",text:"Good morning. I have reviewed the October demo books. Ask me about cash movement, supplier spend, ITC exceptions or upcoming obligations. Answers are limited to the sample workspace and include source links."}
  ]);
  const [chatInput,setChatInput] = useState("");
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""),2800); };
  const refreshTransactions = async () => {
    if (!dbClient || !isAuthenticated || !organizationId) return;
    const { data, error } = await dbClient.from("financial_events")
      .select("id,occurred_at,counterparty_name,description,cash_direction,gross_minor,fee_minor,event_category,source_system,lifecycle_status")
      .eq("organization_id", organizationId).order("occurred_at", { ascending: false }).limit(100);
    if (error) { notify("Transactions could not be refreshed: " + error.message); return; }
    setTransactions((data ?? []).map((row:any) => ({
      id: row.id, date: String(row.occurred_at).slice(0,10),
      party: row.counterparty_name || "Unspecified counterparty",
      description: row.description || row.event_category,
      direction: row.cash_direction === "inflow" ? "in" : "out",
      gross: Number(row.gross_minor || 0), fee: Number(row.fee_minor || 0),
      category: row.event_category, source: row.source_system,
      status: String(row.lifecycle_status).replace(/_/g," ").replace(/\\b\\w/g,(ch:string)=>ch.toUpperCase()),
    })));
  };

  const refreshBankStatementLines = async () => {
    if (!dbClient || !isAuthenticated || !organizationId) return;
    const { data, error } = await dbClient.from("bank_statement_lines")
      .select("id,client_id,transaction_date,narration,debit_minor,credit_minor,external_line_id,statement_import_id,financial_account_id")
      .eq("organization_id", organizationId).order("transaction_date", { ascending: false }).limit(500);
    if (error) { notify("Bank statement lines could not be refreshed: " + error.message); return; }
    setBankStatementLines((data ?? []).map((row:any) => ({
      id: row.external_line_id || row.id,
      date: row.transaction_date,
      narration: row.narration,
      debit: Number(row.debit_minor || 0),
      credit: Number(row.credit_minor || 0),
      direction: Number(row.debit_minor || 0) > 0 ? "Debit" : "Credit",
      amount: Number(row.debit_minor || row.credit_minor || 0),
      import_id: row.statement_import_id,
      financial_account_id: row.financial_account_id || "Unassigned",
    })));
  };

  const refreshJournals = async () => {
    if (!dbClient || !isAuthenticated || !organizationId) return;
    const { data, error } = await dbClient.from("journal_entries")
      .select("id,journal_number,journal_date,narration,lifecycle_status,journal_lines(debit_minor,credit_minor)")
      .eq("organization_id", organizationId).order("journal_date", { ascending: false }).limit(100);
    if (error) { notify("Journal list could not be refreshed: " + error.message); return; }
    setJournalEntries((data ?? []).map((row:any) => ({
      id: row.id, journal_number: row.journal_number, date: row.journal_date,
      narration: row.narration, source: "Manual journal",
      debit: (row.journal_lines ?? []).reduce((sum:number,line:any)=>sum+Number(line.debit_minor||0),0),
      credit: (row.journal_lines ?? []).reduce((sum:number,line:any)=>sum+Number(line.credit_minor||0),0),
      lifecycle_status: row.lifecycle_status,
      status: String(row.lifecycle_status).replace(/_/g," ").replace(/\b\w/g,(ch:string)=>ch.toUpperCase()),
    })));
  };

  // Live tenant data replaces the illustrative client, document, event, task and journal lists.
  // Other modules stay clearly labelled as prototype workbenches until their APIs are wired.
  useEffect(() => {
    if (!dbClient || !isAuthenticated || !organizationId) return;
    let active = true;
    setClients([]);
    setDocuments([]);
    setTransactions([]);
    setRecon([]);
    setTasks([]);
    setJournalEntries([]);
    setBankStatementLines([]);
    (async () => {
      const [clientResult, documentResult, eventResult, taskResult, journalResult, bankLineResult] = await Promise.all([
        dbClient.from("clients").select("id,legal_name,entity_type,gstin,state,annual_turnover_minor,status,relationship_manager").eq("organization_id", organizationId).order("created_at", { ascending: false }),
        dbClient.from("source_documents").select("id,original_filename,counterparty_name,document_type,document_date,total_minor,extraction_confidence,status,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }),
        dbClient.from("financial_events").select("id,occurred_at,counterparty_name,description,cash_direction,gross_minor,fee_minor,event_category,source_system,lifecycle_status").eq("organization_id", organizationId).order("occurred_at", { ascending: false }).limit(100),
        dbClient.from("tasks").select("id,title,due_at,assigned_to,priority,lifecycle_status,client_id").eq("organization_id", organizationId).order("due_at", { ascending: true }).limit(100),
        dbClient.from("journal_entries").select("id,journal_number,journal_date,narration,lifecycle_status,journal_lines(debit_minor,credit_minor)").eq("organization_id", organizationId).order("journal_date", { ascending: false }).limit(100),
        dbClient.from("bank_statement_lines").select("id,client_id,transaction_date,narration,debit_minor,credit_minor,external_line_id,statement_import_id,financial_account_id").eq("organization_id", organizationId).order("transaction_date", { ascending: false }).limit(500),
      ]);
      if (!active) return;
      const errors = [clientResult.error, documentResult.error, eventResult.error, taskResult.error, journalResult.error, bankLineResult.error].filter(Boolean);
      if (errors.length) notify("Some live records could not be loaded. Check the database schema and RLS policies.");
      setClients((clientResult.data ?? []).map((row: any) => ({
        id: row.id, name: row.legal_name, type: String(row.entity_type).replace(/_/g, " ").replace(/\b\w/g, (ch: string) => ch.toUpperCase()),
        gstin: row.gstin || "—", state: row.state || "—", turnover: Number(row.annual_turnover_minor || 0),
        status: row.status === "on_hold" ? "On hold" : String(row.status).replace(/\b\w/g, (ch: string) => ch.toUpperCase()),
        owner: row.relationship_manager || "Unassigned", tasks: 0,
      })));
      setDocuments((documentResult.data ?? []).map((row: any) => ({
        id: row.id, name: row.original_filename, party: row.counterparty_name || "Pending identification",
        kind: String(row.document_type || "unclassified").replace(/_/g, " "), date: row.document_date || String(row.created_at).slice(0, 10),
        amount: Number(row.total_minor || 0), confidence: Number(row.extraction_confidence || 0),
        status: row.status === "needs_review" ? "Needs review" : row.status === "uploaded" ? "Uploaded" : String(row.status).replace(/\b\w/g, (ch: string) => ch.toUpperCase()),
      })));
      setTransactions((eventResult.data ?? []).map((row: any) => ({
        id: row.id, date: String(row.occurred_at).slice(0, 10), party: row.counterparty_name || "Unspecified counterparty",
        description: row.description || row.event_category, direction: row.cash_direction === "inflow" ? "in" : "out",
        gross: Number(row.gross_minor || 0), fee: Number(row.fee_minor || 0), category: row.event_category,
        source: row.source_system, status: String(row.lifecycle_status).replace(/\b\w/g, (ch: string) => ch.toUpperCase()),
      })));
      setTasks((taskResult.data ?? []).map((row: any) => ({
        id: row.id, title: row.title, client: row.client_id || "Organisation task",
        due: row.due_at || "—", assignee: row.assigned_to || "Unassigned", priority: String(row.priority).replace(/\b\w/g, (ch: string) => ch.toUpperCase()),
        status: row.lifecycle_status === "todo" ? "To do" : row.lifecycle_status === "awaiting_review" ? "Awaiting review" : String(row.lifecycle_status).replace(/\b\w/g, (ch: string) => ch.toUpperCase()),
      })));
      setJournalEntries((journalResult.data ?? []).map((row:any) => ({
        id: row.id, journal_number: row.journal_number, date: row.journal_date,
        narration: row.narration, source: "Manual journal",
        debit: (row.journal_lines ?? []).reduce((sum:number,line:any)=>sum+Number(line.debit_minor||0),0),
        credit: (row.journal_lines ?? []).reduce((sum:number,line:any)=>sum+Number(line.credit_minor||0),0),
        lifecycle_status: row.lifecycle_status,
        status: String(row.lifecycle_status).replace(/_/g," ").replace(/\b\w/g,(ch:string)=>ch.toUpperCase()),
      })))
      setBankStatementLines((bankLineResult.data ?? []).map((row:any) => ({
        id: row.external_line_id || row.id,
        date: row.transaction_date,
        narration: row.narration,
        debit: Number(row.debit_minor || 0), credit: Number(row.credit_minor || 0),
        direction: Number(row.debit_minor || 0) > 0 ? "Debit" : "Credit",
        amount: Number(row.debit_minor || row.credit_minor || 0),
        import_id: row.statement_import_id,
        financial_account_id: row.financial_account_id || "Unassigned",
      })));
;
    })();
    return () => { active = false; };
  }, [dbClient, isAuthenticated, organizationId]);


  const go = (path:string) => { location.hash = "/" + path; setSection(path); setMobileOpen(false); setSelected(null); };
  useEffect(() => { const listener = () => setSection(location.hash.replace("#/","") || "overview"); window.addEventListener("hashchange",listener); return () => window.removeEventListener("hashchange",listener); },[]);
  const globalResults = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return [];
    return [...clients.map(x=>({label:x.name,meta:"Client",path:"clients"})),...transactions.map(x=>({label:x.party+" · "+x.description,meta:"Transaction",path:"transactions"})),...documents.map(x=>({label:x.name,meta:"Document",path:"documents"}))].filter(x=>(x.label+" "+x.meta).toLowerCase().includes(q)).slice(0,7);
  },[search,clients,transactions,documents]);
  const addClient = async (event:FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const legalName = String(f.get("name")).trim();
    const typeLabel = String(f.get("type"));
    const entityType = typeLabel === "Private Limited" ? "company" : typeLabel.toLowerCase();
    if (isAuthenticated && dbClient && organizationId) {
      const { data, error } = await dbClient.from("clients").insert({
        organization_id: organizationId,
        legal_name: legalName,
        display_name: legalName,
        entity_type: entityType,
        gstin: String(f.get("gstin") || "").trim() || null,
        state: String(f.get("state") || "Maharashtra"),
        country_code: "IN",
        annual_turnover_minor: 0,
        status: "onboarding",
        created_by: userId,
      }).select("id,legal_name,entity_type,gstin,state,annual_turnover_minor,status,relationship_manager").single();
      if (error) { notify("Client could not be saved: " + error.message); return; }
      const next:Client = { id:data.id,name:data.legal_name,type:typeLabel,gstin:data.gstin||"—",state:data.state||"—",turnover:Number(data.annual_turnover_minor||0),status:"Onboarding",owner:"You",tasks:0 };
      setClients((previous)=>[next,...previous]); setModal(""); notify("Client saved to the organisation workspace.");
      return;
    }
    const next:Client = {id:"CL-"+String(clients.length+1).padStart(3,"0"),name:legalName,type:typeLabel,gstin:String(f.get("gstin")||"—"),state:String(f.get("state")||"Maharashtra"),turnover:0,status:"Onboarding",owner:"You",tasks:0};
    setClients([next,...clients]); setModal(""); notify("Client workspace created in demo session.");
  };
  const uploadDocs = async (files:FileList | null) => {
    if(!files?.length) return;
    if (isAuthenticated && dbClient && organizationId) {
      const created: DocumentItem[] = [];
      for (const file of Array.from(files)) {
        if (file.size > 25 * 1024 * 1024) { notify(file.name + " exceeds the 25 MB upload limit."); continue; }
        const documentId = crypto.randomUUID();
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "document";
        const storagePath = organizationId + "/" + documentId + "/" + safeName;
        const { error: uploadError } = await dbClient.storage.from("aurel-documents").upload(storagePath, file, {
          upsert: false, contentType: file.type || "application/octet-stream",
        });
        if (uploadError) { notify("Upload failed for " + file.name + ": " + uploadError.message); continue; }
        const { data, error } = await dbClient.from("source_documents").insert({
          id: documentId,
          organization_id: organizationId,
          original_filename: file.name,
          storage_bucket: "aurel-documents",
          storage_path: storagePath,
          mime_type: file.type || "application/octet-stream",
          size_bytes: file.size,
          document_type: "unclassified",
          status: "uploaded",
          uploaded_by: userId,
        }).select("id,original_filename,counterparty_name,document_type,document_date,total_minor,extraction_confidence,status,created_at").single();
        if (error) { notify("File is stored but its document record failed: " + error.message); continue; }
        created.push({
          id: data.id, name: data.original_filename, party: data.counterparty_name || "Pending identification",
          kind: data.document_type, date: data.document_date || String(data.created_at).slice(0,10),
          amount: Number(data.total_minor || 0), confidence: Number(data.extraction_confidence || 0), status: "Uploaded",
        });
      }
      if (created.length) {
        setDocuments((previous)=>[...created,...previous]);
        notify(created.length + " document(s) stored in the private organisation bucket. OCR is not connected yet.");
      }
      return;
    }
    const next = Array.from(files).map((file,i)=>({id:"DOC-"+(185+i),name:file.name,party:"Pending identification",kind:file.type.includes("image")?"Image upload":"Document upload",date:dateNow,amount:0,confidence:0,status:"Uploaded"} as DocumentItem));
    setDocuments([...next,...documents]); notify(next.length+" file(s) added to the demo inbox. No cloud upload occurred.");
  };
  const exportCsv = (rows:any[],name:string) => {
    if(!rows.length){notify("No rows to export.");return;}
    const keys=Object.keys(rows[0]); const csv=[keys.join(","),...rows.map(row=>keys.map(k=>'"'+String(row[k]??"").replace(/"/g,'""')+'"').join(","))].join("\n");
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"})); const a=document.createElement("a"); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url); notify("CSV export generated.");
  };
  const respond = (question:string) => {
    if(!question.trim()) return;
    setChat([...chat,{role:"user",text:question}]);
    const q=question.toLowerCase();
    let answer="I can answer from the current demo workspace only. Try asking about October operating cash flow, top spend categories, ITC exceptions, receivables ageing or upcoming deadlines.";
    let source="/overview";
    if(q.includes("spend")||q.includes("expense")){answer="October outgoing cash movement is ₹18.60L in this sample period. People is the largest category at ₹8.25L, followed by raw materials at ₹5.62L. The category view is based on the fictional Kaveri Textiles sample records; it is not a full accrual profit calculation.";source="/insights";}
    else if(q.includes("cash")||q.includes("inflow")||q.includes("revenue")){answer="October operating inflow is ₹42.80L and operating outflow is ₹18.60L, giving a provisional operating cash surplus of ₹24.20L. Owner capital and loan proceeds are excluded. This is cash movement, not audited accounting profit.";source="/cash-flow";}
    else if(q.includes("itc")||q.includes("gst")){answer="The demo GST workbench has 7 open ITC exceptions for October. The largest review group is tax/amount mismatch. Open the ITC workbench to see invoice-level reasons and reviewer actions.";source="/itc";}
    else if(q.includes("due")||q.includes("deadline")){answer="There are 3 upcoming compliance tasks in the current sample workspace. Open the compliance calendar to review the dates and assigned owners. Due dates here are illustrative demo data, not live statutory reminders.";source="/compliance";}
    setChat(prev=>[...prev,{role:"assistant",text:answer,source}]);
    setChatInput("");
  };

  const sidebar = <aside className={"sidebar "+(mobileOpen?"mobile-open":"")}>
    <div className="brand-row"><div className="brand-symbol">A</div><div><div className="brand-name">AUREL</div><div className="brand-sub">FINANCE INTELLIGENCE</div></div><button className="icon-btn mobile-close" onClick={()=>setMobileOpen(false)}><X size={17}/></button></div>
    <button className="org-switch"><div className="org-avatar">{organizationName ? organizationName.charAt(0).toUpperCase() : "K"}</div><div className="org-text"><b>{organizationName || "Kaveri Textiles Pvt. Ltd."}</b><span>{isAuthenticated ? "Connected organisation · FY 2026–27" : "Demo workspace · FY 2026–27"}</span></div><ChevronDown size={15}/></button>
    <div className="nav-scroll">
      <button className={"nav-link solo "+(section==="overview"?"active":"")} onClick={()=>go("overview")}><LayoutDashboard size={17}/><span>Command Centre</span><span className="nav-dot"/></button>
      {navGroups.map(group=><div className="nav-group" key={group.label}><div className="nav-label">{group.label}</div>{group.items.map(([title,path,Icon])=><button key={path} className={"nav-link "+(section===path?"active":"")} onClick={()=>go(path)}><Icon size={16}/><span>{title}</span>{path==="documents"&&<em>8</em>}{path==="itc"&&<em className="alert-count">7</em>}</button>)}</div>)}
    </div>
    <div className="sidebar-bottom"><div className="support-card"><div className="support-icon"><LifeBuoy size={16}/></div><div><b>Need a hand?</b><span>Open product guide</span></div><ChevronRight size={15}/></div><div className="profile-row"><div className="profile-avatar">AS</div><div className="profile-text"><b>Ananya Sen</b><span>Workspace admin</span></div><MoreHorizontal size={17}/></div></div>
  </aside>;

  return <div className="app-shell">
    {sidebar}{mobileOpen&&<div className="mobile-scrim" onClick={()=>setMobileOpen(false)}/>}
    <main className="main-area">
      <header className="topbar"><div className="top-left"><button className="icon-btn mobile-menu" onClick={()=>setMobileOpen(true)}><Menu size={19}/></button><span className="crumb-muted">Workspace</span><ChevronRight size={13}/><span className="crumb-current">{section==="overview"?"Command Centre":navTitle(section)}</span></div>
        <div className="top-actions"><div className="global-search"><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search records, clients..." /><kbd>⌘ K</kbd>{search&&<div className="search-results">{globalResults.length?globalResults.map((r,i)=><button key={i} onClick={()=>{go(r.path);setSearch("");}}><Search size={14}/><span>{r.label}</span><small>{r.meta}</small></button>):<div className="search-empty">No matching records</div>}</div>}</div><div className="period-select"><CalendarDays size={14}/><select value={period} onChange={e=>setPeriod(e.target.value)}><option>Oct 2026</option><option>Sep 2026</option><option>Q2 FY 2026–27</option><option>FY 2026–27</option></select><ChevronDown size={13}/></div><button className="icon-btn notification-btn" onClick={()=>notify("You are all caught up in this demo workspace.")}><Bell size={17}/><i/></button><div className="top-avatar">AS</div></div>
      </header>
      <div className="demo-banner"><span className="demo-pip"/> {isAuthenticated ? "CONNECTED WORKSPACE" : "DEMO WORKSPACE"} <span className="banner-divider"/> {isAuthenticated ? "Clients and documents use the database; accounting, tax and analytics workbenches remain sample-only." : "All records and integrations shown are fictional sample data"} <button onClick={()=>notify(isAuthenticated ? "Live persistence currently covers client records and document storage. Other modules are still prototype-only." : "Demo data is stored only in this browser session.")}>Data boundaries <ArrowRight size={12}/></button></div>
      <div className="page-content">{section==="overview"?<Dashboard period={period} transactions={transactions} tasks={tasks} go={go} openAssistant={()=>setAssistantOpen(true)} demoMode={!isAuthenticated} />:<ModulePage section={section} clients={clients} documents={documents} transactions={transactions} recon={recon} tasks={tasks} journalEntries={journalEntries} bankStatementLines={bankStatementLines} selected={selected} isAuthenticated={isAuthenticated} dbClient={dbClient} organizationId={organizationId} period={period} onJournalRefresh={refreshJournals} setSelected={setSelected} setModal={setModal} notify={notify} go={go} exportCsv={exportCsv} setRecon={setRecon} setTasks={setTasks} uploadDocs={uploadDocs} />}</div>
    </main>
    {assistantOpen&&<div className="assistant-backdrop" onClick={()=>setAssistantOpen(false)}/>}
    <button className="assistant-fab" onClick={()=>setAssistantOpen(!assistantOpen)}><Sparkles size={17}/><span>AUREL Agent</span></button>
    {assistantOpen&&<aside className="assistant-panel"><div className="assistant-head"><div className="agent-mark"><Sparkles size={17}/></div><div><b>AUREL Agent</b><span>{isAuthenticated ? "Secure session · limited data tools" : "Finance intelligence · Demo mode"}</span></div><button className="icon-btn" onClick={()=>setAssistantOpen(false)}><X size={17}/></button></div><div className="agent-trust"><ShieldCheck size={14}/> {isAuthenticated ? "Live client/document adapters are connected. Financial and tax metric tools are not connected." : "Answers use sample metrics and link to supporting screens."}</div><div className="chat-stream">{chat.map((m,i)=><div className={"chat-message "+m.role} key={i}><div className="chat-avatar">{m.role==="assistant"?<Sparkles size={13}/>:<UserRound size={13}/>}</div><div><div className="chat-bubble">{m.text}</div>{m.source&&<button className="source-link" onClick={()=>{go(m.source!.replace("/",""));setAssistantOpen(false);}}>View supporting records <ArrowUpRight size={12}/></button>}</div></div>)}</div><div className="suggestions"><span>TRY ASKING</span>{["Why did spend rise this month?","Summarise October cash flow","What needs GST review?"].map(x=><button key={x} onClick={()=>respond(x)}>{x}<ArrowUpRight size={12}/></button>)}</div><form className="chat-composer" onSubmit={e=>{e.preventDefault();respond(chatInput);}}><input value={chatInput} onChange={e=>setChatInput(e.target.value)} placeholder="Ask about your business..." /><button type="submit"><Send size={15}/></button></form></aside>}
    {modal==="client"&&<Modal title="Add a client" subtitle="Create a secure workspace for a new business entity." onClose={()=>setModal("")}><form className="form-grid" onSubmit={addClient}><label className="full">Legal business name<input name="name" placeholder="e.g. Meridian Components Pvt. Ltd." required /></label><label>Entity type<select name="type"><option>Proprietorship</option><option>Partnership</option><option>LLP</option><option>Private Limited</option><option>Individual</option></select></label><label>State<select name="state"><option>Maharashtra</option><option>Karnataka</option><option>Gujarat</option><option>Delhi</option><option>Telangana</option></select></label><label className="full">GSTIN <span className="optional">Optional for onboarding</span><input name="gstin" placeholder="Enter GSTIN" maxLength={15}/></label><div className="modal-note full"><LockKeyhole size={14}/> Sensitive identifiers are masked in the interface. {isAuthenticated ? "Client details are stored in the selected organisation." : "Demo form only; data is not saved to a backend."}</div><div className="modal-actions full"><button type="button" className="btn btn-quiet" onClick={()=>setModal("")}>Cancel</button><button className="btn btn-primary" type="submit"><Plus size={15}/> Create client</button></div></form></Modal>}
    {modal==="import"&&<BankImportModal onClose={()=>setModal("")} notify={notify} dbClient={dbClient} organizationId={organizationId} clients={clients} isAuthenticated={isAuthenticated} onImported={async()=>{await Promise.all([refreshTransactions(),refreshBankStatementLines()]);}}/>}
    {modal==="upload"&&<Modal title="Upload source documents" subtitle="Add bills, invoices, receipts or statements to the sample inbox." onClose={()=>setModal("")}><div className="upload-zone"><Upload size={22}/><b>Choose documents to add</b><span>PDF, JPG, PNG, CSV or XLSX · {isAuthenticated ? "private organisation storage" : "browser-only demo"}</span><input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.csv,.xlsx" onChange={e=>{uploadDocs(e.target.files);setModal("");}} /></div><div className="modal-note"><LockKeyhole size={14}/>{isAuthenticated ? "Files are stored in the private organisation bucket. OCR/extraction is not connected yet." : "Files are not sent to a server in this demo. Production uploads require secure storage and malware scanning."}</div><div className="modal-actions"><button className="btn btn-quiet" onClick={()=>setModal("")}>Close</button></div></Modal>}{modal==="generic"&&<Modal title="Create a draft record" subtitle="This action creates a local demonstration draft only." onClose={()=>setModal("")}><form className="form-grid" onSubmit={e=>{e.preventDefault();setModal("");notify("Draft record created in the current demo session.");}}><label className="full">Record name<input required placeholder="Enter a short record description"/></label><label>Effective date<input type="date" defaultValue="2026-11-09"/></label><label>Owner<select defaultValue="Ananya Sen"><option>Ananya Sen</option><option>Priya Nair</option><option>Rahul Iyer</option></select></label><div className="modal-note full"><AlertCircle size={14}/> Drafts are not posted to accounting records and are not persisted to a backend.</div><div className="modal-actions full"><button type="button" className="btn btn-quiet" onClick={()=>setModal("")}>Cancel</button><button className="btn btn-primary" type="submit">Save demo draft</button></div></form></Modal>}{modal==="journal"&&<JournalModal onClose={()=>setModal("")} notify={notify} dbClient={dbClient} organizationId={organizationId} clients={clients} isAuthenticated={isAuthenticated} onSaved={(entry:any)=>setJournalEntries((previous:any[])=>[entry,...previous.filter((row:any)=>row.id!==entry.id)])}/>}
    {selected&&<div className="detail-backdrop" onClick={()=>setSelected(null)}><aside className="detail-panel" onClick={e=>e.stopPropagation()}><div className="detail-head"><div><span className="eyebrow">RECORD DETAIL</span><h3>{selected.name||selected.party||selected.title||selected.id}</h3></div><button className="icon-btn" onClick={()=>setSelected(null)}><X size={17}/></button></div><div className="detail-body"><div className="detail-tag">Sample record · Read only source context</div>{Object.entries(selected).map(([key,value])=><div className="detail-field" key={key}><span>{key.replace(/([A-Z])/g," $1")}</span><b>{typeof value==="number"&&key.toLowerCase().includes("amount")?inr(value):String(value)}</b></div>)}</div>{String(selected.id||"").startsWith("DOC-")&&<div className="detail-actions"><button className="btn btn-primary" onClick={()=>{setDocuments(documents.map((d:any)=>d.id===selected.id?{...d,status:"Approved"}:d));setSelected(null);notify("Extraction approved in demo session. Accounting posting remains a separate review step.");}}><Check size={14}/> Approve extraction</button><button className="btn btn-quiet" onClick={()=>{setDocuments(documents.map((d:any)=>d.id===selected.id?{...d,status:"Rejected"}:d));setSelected(null);notify("Extraction rejected in demo session.");}}>Reject</button></div>}<button className="btn btn-quiet detail-close" onClick={()=>setSelected(null)}>Close detail</button></aside></div>}
    {toast&&<div className="toast"><CheckCircle2 size={16}/>{toast}</div>}
  </div>;
}

export default App;

function Dashboard({period,transactions,tasks,go,openAssistant,demoMode=true}:any) {
  return <div className="dashboard animate-in">
    <div className="page-heading"><div><div className="eyebrow">MONDAY, 09 NOVEMBER 2026 <span className="heading-dot"/> FINANCIAL OVERVIEW</div><h1>{demoMode ? "Good morning, Ananya" : "Your workspace"}<span className="heading-period">.</span></h1><p>{demoMode ? "Your business has a healthy cash position. Here is what needs your attention." : "Your organisation is connected. Add source records before AUREL calculates financial performance."}</p></div><div className="heading-actions"><button className="btn btn-quiet" onClick={()=>openAssistant()}><Sparkles size={15}/> Ask AUREL</button><button className="btn btn-primary" onClick={()=>go("documents")}><Upload size={15}/> Add documents</button></div></div>
    <div className="context-line"><span className="context-pill"><CalendarDays size={13}/>{period}</span><span className="coverage-text"><ShieldCheck size={13}/> {demoMode ? "Source coverage: 92% of connected demo records" : "Live workspace · financial source coverage not yet calculated"}</span><span className="coverage-right">Last refreshed 09:42 AM</span></div>
    <div className="kpi-grid">
      <Kpi label="Operating inflow" value={demoMode ? "₹42.80L" : "—"} change={demoMode ? "+18.4%" : "No ledger data"} positive helper={demoMode ? "Customer receipts and operating credits" : "Awaiting persisted financial events"} icon={<ArrowDownLeft size={17}/>} color="green"/>
      <Kpi label="Operating outflow" value={demoMode ? "₹18.60L" : "—"} change={demoMode ? "−6.2%" : "No ledger data"} positive helper={demoMode ? "Vendor, people and operating spend" : "Awaiting persisted financial events"} icon={<ArrowUpRight size={17}/>} color="ink"/>
      <Kpi label="Provisional operating surplus" value={demoMode ? "₹24.20L" : "—"} change={demoMode ? "+32.8%" : "Not calculated"} positive helper="Cash basis · not accounting profit" icon={<Activity size={17}/>} color="gold"/>
      <Kpi label="Available cash" value={demoMode ? "₹31.40L" : "—"} change={demoMode ? "+8.1%" : "No bank source"} positive helper={demoMode ? "Latest known connected balances" : "Connect an authorised source to calculate"} icon={<Wallet size={17}/>} color="blue"/>
    </div>
    <div className="content-grid primary-grid">
      <section className="panel cash-panel"><div className="panel-head"><div><div className="eyebrow">CASH MOVEMENT</div><h3>Inflow vs outflow</h3><p>Operating cash movement over the last six months</p></div><button className="select-ghost">Monthly <ChevronDown size={13}/></button></div><div className="chart-legend"><span><i className="legend-dot inflow-dot"/> Inflow</span><span><i className="legend-dot outflow-dot"/> Outflow</span><small>₹ lakh</small></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={demoMode ? cashSeries : []} margin={{top:8,right:8,left:-16,bottom:0}}><defs><linearGradient id="inflowFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#20785f" stopOpacity={.18}/><stop offset="100%" stopColor="#20785f" stopOpacity={0}/></linearGradient><linearGradient id="outflowFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#9aa7a0" stopOpacity={.15}/><stop offset="100%" stopColor="#9aa7a0" stopOpacity={0}/></linearGradient></defs><CartesianGrid vertical={false} stroke="#e9ede8" strokeDasharray="3 4"/><XAxis dataKey="period" axisLine={false} tickLine={false} tick={{fontSize:11,fill:"#89938d"}} dy={10}/><YAxis axisLine={false} tickLine={false} tick={{fontSize:10,fill:"#89938d"}} tickFormatter={v=>"₹"+v+"L"}/><Tooltip contentStyle={{border:"1px solid #e5e9e3",borderRadius:10,fontSize:12}} formatter={(value:any)=>"₹"+value+"L"}/><Area type="monotone" dataKey="inflow" stroke="#24785f" fill="url(#inflowFill)" strokeWidth={2.5}/><Area type="monotone" dataKey="outflow" stroke="#9aa7a0" fill="url(#outflowFill)" strokeWidth={2}/></AreaChart></ResponsiveContainer></div><div className="chart-footer"><span>{demoMode ? "May–Oct 2026 · Sample ledger" : "No persisted cash ledger available yet"}</span><button className="text-link" onClick={()=>go("cash-flow")}>View cash flow <ArrowRight size={13}/></button></div></section>
      <section className="panel spend-panel"><div className="panel-head"><div><div className="eyebrow">COST STRUCTURE</div><h3>Where money goes</h3><p>Operating outflow · October</p></div><button className="more-btn">···</button></div><div className="spend-total"><strong>{demoMode ? "₹18.60L" : "—"}</strong><span><i className="status-dot good"/> {demoMode ? "within monthly plan" : "No spend classification yet"}</span></div><div className="spend-chart"><div className="donut-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={demoMode ? spendSeries : []} dataKey="value" nameKey="name" innerRadius={49} outerRadius={67} paddingAngle={3} stroke="none">{spendSeries.map((x,i)=><Cell key={i} fill={x.color}/>)}</Pie><Tooltip formatter={(v:any)=>"₹"+v+"L"}/></PieChart></ResponsiveContainer><div className="donut-center"><b>{demoMode ? "100%" : "—"}</b><span>{demoMode ? "allocated" : "no data"}</span></div></div><div className="spend-legend">{(demoMode ? spendSeries : []).map(item=><div key={item.name}><i style={{background:item.color}}/><span>{item.name}</span><b>₹{item.value.toFixed(2)}L</b></div>)}</div></div><button className="text-link panel-link" onClick={()=>go("insights")}>Explore spend analytics <ArrowRight size={13}/></button></section>
    </div>
    <div className="content-grid secondary-grid">
      <section className="panel queue-panel"><div className="panel-head"><div><div className="eyebrow">NEEDS ATTENTION</div><h3>Review queue <span className="count-bubble">{demoMode ? 8 : tasks.filter((task:any)=>task.status!=="Done").length}</span></h3><p>{demoMode ? "Exceptions that need a human decision · sample records" : "Tasks stored in this organisation workspace"}</p></div><button className="text-link" onClick={()=>go("tasks")}>View all <ArrowRight size={13}/></button></div>{demoMode ? <div className="queue-list"><div className="queue-item"><div className="queue-icon warning"><FileSpreadsheet size={16}/></div><div className="queue-main"><b>7 ITC exceptions need review</b><span>Kaveri Textiles · October 2026</span></div><span className="priority-tag high">HIGH</span><button onClick={()=>go("itc")}><ArrowRight size={15}/></button></div><div className="queue-item"><div className="queue-icon red"><FileText size={16}/></div><div className="queue-main"><b>Credit note extraction confidence 79%</b><span>Lotus Retail House · CN-088</span></div><span className="priority-tag medium">MEDIUM</span><button onClick={()=>go("documents")}><ArrowRight size={15}/></button></div><div className="queue-item"><div className="queue-icon blue"><GitCompareArrows size={16}/></div><div className="queue-main"><b>4 bank statement lines unmatched</b><span>HDFC Bank · October 2026</span></div><span className="priority-tag medium">MEDIUM</span><button onClick={()=>go("reconciliation")}><ArrowRight size={15}/></button></div><div className="queue-item"><div className="queue-icon neutral"><LockKeyhole size={16}/></div><div className="queue-main"><b>Partnership deed is still pending</b><span>Coastal Agro Foods LLP · Onboarding</span></div><span className="priority-tag low">LOW</span><button onClick={()=>go("clients")}><ArrowRight size={15}/></button></div></div> : <div className="live-empty-state"><CheckCircle2 size={17}/><b>No live review queue is configured yet.</b><span>ITC, reconciliation and extraction exceptions will appear here once those services are connected.</span></div>}</section>
      <section className="panel deadlines-panel"><div className="panel-head"><div><div className="eyebrow">UP NEXT</div><h3>Compliance calendar</h3><p>{demoMode ? "Illustrative deadlines · verify applicability" : "Live statutory calendar is not configured"}</p></div><button className="text-link" onClick={()=>go("compliance")}>Calendar <ArrowRight size={13}/></button></div>{demoMode ? <div className="deadline-list"><div className="deadline-row"><div className="date-tile"><b>11</b><span>NOV</span></div><div><b>GSTR-1 workpaper review</b><span>Kaveri Textiles · Priya Nair</span></div><span className="deadline-state">Tomorrow</span></div><div className="deadline-row"><div className="date-tile"><b>15</b><span>NOV</span></div><div><b>Monthly MIS pack</b><span>Meridian Cloud · Rahul Iyer</span></div><span className="deadline-state">6 days</span></div><div className="deadline-row"><div className="date-tile"><b>20</b><span>NOV</span></div><div><b>GSTR-3B preparation</b><span>Northstar Components · Priya Nair</span></div><span className="deadline-state">11 days</span></div></div> : <div className="live-empty-state"><CalendarDays size={17}/><b>No verified deadlines are loaded.</b><span>Do not rely on sample dates for statutory compliance.</span></div>}</section>
    </div>
    <section className="panel activity-panel"><div className="panel-head"><div><div className="eyebrow">LATEST ACTIVITY</div><h3>Recent financial events</h3><p>Unified activity across connected demo sources</p></div><button className="text-link" onClick={()=>go("transactions")}>All transactions <ArrowRight size={13}/></button></div><div className="table-scroll"><table className="data-table"><thead><tr><th>COUNTERPARTY</th><th>DESCRIPTION</th><th>DATE</th><th>SOURCE</th><th>AMOUNT</th><th>STATUS</th></tr></thead><tbody>{transactions.slice(0,5).map(t=><tr key={t.id}><td><div className="party-cell"><div className="party-avatar">{t.party.charAt(0)}</div><b>{t.party}</b></div></td><td className="muted-cell">{t.description}</td><td>{t.date}</td><td><span className="source-chip">{t.source}</span></td><td className={"amount-cell "+(t.direction==="in"?"positive-amount":"")}>{t.direction==="in"?"+":"−"}{inr(t.gross)}</td><td><Status value={t.status}/></td></tr>)}</tbody></table></div></section>
    <div className="footer-note"><ShieldCheck size={13}/> Figures shown are illustrative. Provisional operating surplus is cash-basis and is not a substitute for a complete accrual-based P&L.</div>
  </div>;
}

function Kpi({label,value,change,positive,helper,icon,color}:any){return <div className="kpi-card"><div className="kpi-top"><span>{label}</span><div className={"kpi-icon "+color}>{icon}</div></div><strong>{value}</strong><div className="kpi-bottom"><span className={"change "+(positive?"up":"down")}>{change}</span><span>{helper}</span></div></div>;}
function Status({value}:any){const v=String(value).toLowerCase();const cls=v.includes("approved")||v.includes("matched")||v.includes("reconciled")||v.includes("done")||v.includes("active")||v.includes("ready")?"success":v.includes("review")||v.includes("suggest")||v.includes("pending")||v.includes("progress")?"warning":v.includes("missing")||v.includes("blocked")||v.includes("mismatch")||v.includes("overdue")||v.includes("duplicate")?"danger":"neutral";return <span className={"status "+cls}><i/>{value}</span>;}
function Modal({title,subtitle,onClose,children}:any){return <div className="modal-backdrop" onClick={onClose}><section className="modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><h3>{title}</h3><p>{subtitle}</p></div><button className="icon-btn" onClick={onClose}><X size={17}/></button></div>{children}</section></div>;}
function JournalModal({onClose,notify,dbClient,organizationId,clients=[],isAuthenticated=false,onSaved}:any){
  const [debit,setDebit]=useState("10000");const [credit,setCredit]=useState("10000");
  const [journalDate,setJournalDate]=useState("2026-11-09");const [narration,setNarration]=useState("Monthly operating expense");
  const [clientId,setClientId]=useState(clients[0]?.id||"");const [accounts,setAccounts]=useState<any[]>([]);
  const [debitAccount,setDebitAccount]=useState("");const [creditAccount,setCreditAccount]=useState("");
  const [loadingAccounts,setLoadingAccounts]=useState(false);const [saving,setSaving]=useState(false);const [accountMessage,setAccountMessage]=useState("");
  const verdict=validateJournal([{debit:rupees(Number(debit)||0),credit:0},{debit:0,credit:rupees(Number(credit)||0)}]);
  useEffect(()=>{if(clients.length&&!clients.some((client:any)=>client.id===clientId))setClientId(clients[0].id);},[clients,clientId]);
  useEffect(()=>{
    if(!isAuthenticated||!dbClient||!organizationId||!clientId){setAccounts([]);return;}
    let active=true;setLoadingAccounts(true);
    dbClient.from("accounts").select("id,account_code,account_name,account_group,normal_balance").eq("organization_id",organizationId).eq("client_id",clientId).eq("is_active",true).order("account_code")
      .then(({data,error}:any)=>{
        if(!active)return;
        if(error){setAccountMessage("Accounts could not be loaded: "+error.message);setAccounts([]);}
        else{const rows=data??[];setAccounts(rows);setAccountMessage(rows.length?"":"No chart of accounts exists for this client yet. Initialise the starter chart first.");
          if(rows.length){setDebitAccount((cur:string)=>cur&&rows.some((a:any)=>a.id===cur)?cur:(rows.find((a:any)=>a.account_code==="5400")?.id??rows[0].id));setCreditAccount((cur:string)=>cur&&rows.some((a:any)=>a.id===cur)?cur:(rows.find((a:any)=>a.account_code==="1010")?.id??rows.find((a:any)=>a.account_group==="liability")?.id??rows[1]?.id??rows[0].id));}
        }setLoadingAccounts(false);
      });
    return()=>{active=false;};
  },[dbClient,isAuthenticated,organizationId,clientId]);
  const initialiseAccounts=async()=>{
    if(!dbClient||!organizationId||!clientId)return;setSaving(true);setAccountMessage("");
    const {data,error}=await dbClient.rpc("ensure_default_chart_of_accounts",{p_organization_id:organizationId,p_client_id:clientId});
    if(error){setAccountMessage("Chart initialisation failed: "+error.message);setSaving(false);return;}
    const {data:rows,error:loadError}=await dbClient.from("accounts").select("id,account_code,account_name,account_group,normal_balance").eq("organization_id",organizationId).eq("client_id",clientId).eq("is_active",true).order("account_code");
    if(loadError)setAccountMessage("Chart created, but accounts could not be loaded: "+loadError.message);
    else{const list=rows??[];setAccounts(list);setAccountMessage("Starter chart initialised ("+Number(data||0)+" new accounts).");setDebitAccount(list.find((a:any)=>a.account_code==="5400")?.id??list[0]?.id??"");setCreditAccount(list.find((a:any)=>a.account_code==="1010")?.id??list[1]?.id??"");}
    setSaving(false);
  };
  const save=async()=>{
    if(!verdict.balanced){notify("The journal must balance before it can be saved.");return;}
    if(!isAuthenticated){onClose();notify("Balanced demo journal saved in this browser session. It was not posted to a ledger.");return;}
    if(!dbClient||!organizationId||!clientId){notify("Select a connected client before creating a journal.");return;}
    if(!debitAccount||!creditAccount||accounts.length<2){notify("Initialise the client's chart of accounts before creating a journal.");return;}
    if(debitAccount===creditAccount){notify("Choose two different accounts for this journal.");return;}
    if(!narration.trim()){notify("Enter a journal narration.");return;}
    setSaving(true);
    const lines=[{account_id:debitAccount,debit_minor:rupees(Number(debit)),credit_minor:0,description:narration.trim()},{account_id:creditAccount,debit_minor:0,credit_minor:rupees(Number(credit)),description:narration.trim()}];
    const {data:id,error}=await dbClient.rpc("create_journal_draft",{p_organization_id:organizationId,p_client_id:clientId,p_journal_date:journalDate,p_narration:narration.trim(),p_lines:lines});
    if(error){notify("Journal draft was not saved: "+error.message);setSaving(false);return;}
    const {data:row,error:readError}=await dbClient.from("journal_entries").select("id,journal_number,journal_date,narration,lifecycle_status,journal_lines(debit_minor,credit_minor)").eq("organization_id",organizationId).eq("id",id).single();
    const saved=row?{id:row.id,journal_number:row.journal_number,date:row.journal_date,narration:row.narration,source:"Manual journal",debit:(row.journal_lines??[]).reduce((s:number,l:any)=>s+Number(l.debit_minor||0),0),credit:(row.journal_lines??[]).reduce((s:number,l:any)=>s+Number(l.credit_minor||0),0),lifecycle_status:row.lifecycle_status,status:"Draft"}:{id:String(id),journal_number:"Saved draft",date:journalDate,narration,source:"Manual journal",debit:verdict.debit,credit:verdict.credit,lifecycle_status:"draft",status:"Draft"};
    if(readError)notify("Journal draft saved, but the list could not be refreshed: "+readError.message);
    onSaved?.(saved);notify("Balanced journal draft saved. Submit it for review before posting.");setSaving(false);onClose();
  };
  return <Modal title="New journal entry" subtitle={isAuthenticated?"Create a balanced draft in the selected client ledger. Posting requires review and approval.":"Prepare a balanced demonstration journal."} onClose={onClose}><div className="form-grid">
    {isAuthenticated&&<label className="full">Client / entity<select value={clientId} onChange={e=>setClientId(e.target.value)}>{clients.map((c:any)=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
    <label>Journal date<input type="date" value={journalDate} onChange={e=>setJournalDate(e.target.value)}/></label>
    <label>Amount (INR)<input type="number" min="0.01" step="0.01" value={debit} onChange={e=>{setDebit(e.target.value);setCredit(e.target.value);}}/></label>
    <label className="full">Narration<input value={narration} onChange={e=>setNarration(e.target.value)} maxLength={500}/></label>
    <div className="journal-line full"><div><b>Debit account</b><span>Dr</span></div>{isAuthenticated?<select value={debitAccount} onChange={e=>setDebitAccount(e.target.value)} disabled={loadingAccounts||!accounts.length}><option value="">Select account</option>{accounts.map((a:any)=><option key={a.id} value={a.id}>{a.account_code} · {a.account_name}</option>)}</select>:<b>Operating expenses</b>}</div>
    <div className="journal-line full"><div><b>Credit account</b><span>Cr</span></div>{isAuthenticated?<select value={creditAccount} onChange={e=>setCreditAccount(e.target.value)} disabled={loadingAccounts||!accounts.length}><option value="">Select account</option>{accounts.map((a:any)=><option key={a.id} value={a.id}>{a.account_code} · {a.account_name}</option>)}</select>:<b>Accrued expenses payable</b>}</div>
    {isAuthenticated&&<div className="modal-note full"><BookOpen size={14}/>{loadingAccounts?"Loading chart of accounts…":accountMessage||"Only active accounts for this client can be selected."}{accounts.length===0&&!loadingAccounts&&<button type="button" className="text-link" onClick={initialiseAccounts} disabled={saving}>Initialise starter chart</button>}</div>}
    <div className={"balance-check full "+(verdict.balanced?"balanced":"unbalanced")}><span>{verdict.balanced?"Balanced journal":"Journal is not balanced"}</span><b>Difference: {inr(verdict.difference)}</b></div>
    <div className="modal-actions full"><button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!verdict.balanced||saving||(isAuthenticated&&(!debitAccount||!creditAccount||!clientId))} onClick={save}>{saving?"Saving…":"Save draft"}</button></div>
  </div></Modal>;
}
function BankImportModal({onClose,notify,dbClient,organizationId,clients=[],isAuthenticated=false,onImported}:any){
  const [file,setFile]=useState<File|null>(null);
  const [headers,setHeaders]=useState<string[]>([]);
  const [rows,setRows]=useState<string[][]>([]);
  const [mapping,setMapping]=useState({date:-1,narration:-1,debit:-1,credit:-1});
  const [clientId,setClientId]=useState(clients[0]?.id||"");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [result,setResult]=useState<any>(null);

  useEffect(()=>{
    if(clients.length&&!clients.some((client:any)=>client.id===clientId))setClientId(clients[0].id);
  },[clients,clientId]);

  const prepared=useMemo(()=>rows.map((row,index)=>{
    const cell=(column:number)=>column>=0?String(row[column]??"").trim():"";
    const date=parseBankStatementDate(cell(mapping.date));
    const narration=cell(mapping.narration);
    const debit=parseRupeeMinor(cell(mapping.debit));
    const credit=parseRupeeMinor(cell(mapping.credit));
    const problems:string[]=[];
    if(!date)problems.push("Invalid transaction date");
    if(!narration||narration.length>1000)problems.push("Missing or overlong narration");
    if(debit===null||credit===null)problems.push("Invalid debit/credit amount");
    if(debit!==null&&credit!==null&&!((debit>0&&credit===0)||(credit>0&&debit===0)))problems.push("Set either debit or credit amount (not both)");
    return {index,row,date,narration,debit,credit,problems};
  }),[rows,mapping]);
  const validRows=prepared.filter(row=>row.problems.length===0);
  const invalidRows=prepared.filter(row=>row.problems.length>0);

  const infer=(names:string[],patterns:RegExp[])=>names.findIndex(name=>patterns.some(pattern=>pattern.test(name.toLowerCase().replace(/[_-]+/g," "))));
  const loadFile=async(selected:File|null)=>{
    setError("");setResult(null);setFile(selected);setHeaders([]);setRows([]);
    if(!selected)return;
    if(selected.size>10*1024*1024){setError("CSV is larger than 10 MB. Split the statement into smaller files.");return;}
    try{
      const parsed=parseCsv(await selected.text());
      if(parsed.length<2){setError("The CSV must contain a header row and at least one transaction.");return;}
      const columnNames=parsed[0].map((value,index)=>value.trim()||"Column "+(index+1));
      const data=parsed.slice(1).filter(row=>row.some(value=>value.trim()));
      if(data.length>5000){setError("This import contains more than 5,000 rows. Split it into smaller files.");return;}
      setHeaders(columnNames);setRows(data);
      setMapping({
        date:infer(columnNames,[/date/,/txn dt/,/value dt/]),
        narration:infer(columnNames,[/narration/,/description/,/particular/,/remarks/,/details/]),
        debit:infer(columnNames,[/^debit/,/withdrawal/,/paid out/]),
        credit:infer(columnNames,[/^credit/,/deposit/,/paid in/]),
      });
    }catch(parseError){
      setError(parseError instanceof Error?parseError.message:"Could not parse the CSV file.");
    }
  };

  const importRows=async()=>{
    setError("");setResult(null);
    if(!file||!rows.length){setError("Choose a statement CSV first.");return;}
    if(mapping.date<0||mapping.narration<0||mapping.debit<0||mapping.credit<0){setError("Map date, narration, debit and credit columns before importing.");return;}
    if(new Set([mapping.date,mapping.narration,mapping.debit,mapping.credit]).size!==4){setError("Each required field must use a different CSV column.");return;}
    if(invalidRows.length){setError("Fix the column mappings or source rows. Import is atomic; invalid rows will not be silently skipped.");return;}
    if(!isAuthenticated){setResult({demo:true,valid:validRows.length});notify("CSV preview validated. Demo mode does not persist statement rows.");return;}
    if(!dbClient||!organizationId||!clientId){setError("Select a connected organisation client before importing.");return;}
    setBusy(true);
    try{
      const fileHash=await sha256Hex(await file.arrayBuffer());
      const statementImportId=hashHexToUuid(fileHash);
      const payload=[];
      for(const item of validRows){
        const rowHash=await sha256Hex(JSON.stringify([item.index,item.row]));
        payload.push({
          external_line_id:"csv:"+rowHash,
          transaction_date:item.date,
          narration:item.narration,
          debit_minor:item.debit,
          credit_minor:item.credit,
          source_row:{headers,values:item.row},
        });
      }
      const {data,error:importError}=await dbClient.rpc("import_bank_statement_rows",{
        p_organization_id:organizationId,
        p_client_id:clientId,
        p_financial_account_id:null,
        p_statement_import_id:statementImportId,
        p_rows:payload,
      });
      if(importError)throw new Error(importError.message);
      setResult({demo:false,...data});
      await onImported?.();
      notify("Bank statement imported. Each row is stored as evidence and a reviewable cash event.");
    }catch(importError){
      setError(importError instanceof Error?importError.message:"Bank statement import failed.");
    }finally{
      setBusy(false);
    }
  };

  const renderColumn=(label:string,key:"date"|"narration"|"debit"|"credit")=><label>{label}
    <select value={mapping[key]} onChange={event=>setMapping(current=>({...current,[key]:Number(event.target.value)}))}>
      <option value={-1}>Select column</option>
      {headers.map((header,index)=><option key={index} value={index}>{header}</option>)}
    </select>
  </label>;

  return <Modal title="Import bank statement" subtitle="Map a CSV, validate every row and import source-backed statement evidence." onClose={onClose}>
    <div className="form-grid">
      {isAuthenticated&&<label className="full">Client / entity<select value={clientId} onChange={event=>setClientId(event.target.value)}>{clients.map((client:any)=><option key={client.id} value={client.id}>{client.name}</option>)}</select></label>}
      <label className="full">Statement CSV<input type="file" accept=".csv,text/csv" onChange={event=>loadFile(event.target.files?.[0]??null)}/></label>
      {file&&<div className="modal-note full"><FileSpreadsheet size={14}/>{file.name} · {(file.size/1024).toFixed(1)} KB · {rows.length.toLocaleString("en-IN")} data rows</div>}
      {headers.length>0&&<>
        <div className="full eyebrow">COLUMN MAPPING</div>
        <div className="csv-mapping-grid full">{renderColumn("Transaction date","date")}{renderColumn("Description / narration","narration")}{renderColumn("Debit amount (INR)","debit")}{renderColumn("Credit amount (INR)","credit")}</div>
        <div className="mini-stats full"><MiniStat label="Rows detected" value={String(rows.length)} sub="CSV data rows"/><MiniStat label="Valid rows" value={String(validRows.length)} sub="Ready to import"/><MiniStat label="Invalid rows" value={String(invalidRows.length)} sub="Must be corrected"/><MiniStat label="Import mode" value={isAuthenticated?"Live":"Preview"} sub={isAuthenticated?"Organisation-scoped":"No database writes"}/></div>
        <div className="csv-preview-wrap full"><table className="data-table"><thead><tr><th>ROW</th><th>DATE</th><th>NARRATION</th><th>DEBIT</th><th>CREDIT</th><th>VALIDATION</th><th>ISSUES</th></tr></thead><tbody>{prepared.slice(0,6).map(item=><tr key={item.index}><td>{item.index+1}</td><td>{item.date||"—"}</td><td>{item.narration||"—"}</td><td>{item.debit===null?"Invalid":inr(item.debit)}</td><td>{item.credit===null?"Invalid":inr(item.credit)}</td><td><Status value={item.problems.length?"Invalid":"Valid"}/></td><td>{item.problems.join("; ")||"—"}</td></tr>)}</tbody></table>{rows.length>6&&<small>Showing first 6 of {rows.length.toLocaleString("en-IN")} rows.</small>}</div>
      </>}
      {error&&<div className="auth-alert error full">{error}</div>}
      {result&&<div className="modal-note full"><CheckCircle2 size={15}/>{result.demo?("Demo validation passed for "+result.valid+" rows; no records were saved."):("Imported "+Number(result.statement_lines_inserted||0)+" statement lines and created "+Number(result.financial_events_created||0)+" financial events; skipped "+Number(result.duplicate_lines_skipped||0)+" duplicates.")}</div>}
      {isAuthenticated&&<div className="modal-note full"><ShieldCheck size={14}/>Imported credits/debits are recorded as cash movement with category “other”. They are not assumed to be sales, revenue or expenses. Reconciliation and accounting review remain separate.</div>}
      <div className="modal-actions full"><button className="btn btn-quiet" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy||!file||!rows.length||invalidRows.length>0||!headers.length||(isAuthenticated&&!clientId)} onClick={importRows}>{busy?"Importing…":isAuthenticated?"Import statement":"Validate preview"}</button></div>
    </div>
  </Modal>;
}

function ModulePage({section,clients,documents,transactions,recon,tasks,journalEntries=[],bankStatementLines=[],selected,isAuthenticated=false,dbClient,organizationId,period="Oct 2026",onJournalRefresh,setSelected,setModal,notify,go,exportCsv,setRecon,setTasks,uploadDocs}:any){
  const [query,setQuery]=useState("");const [tab,setTab]=useState("Overview");const [filter,setFilter]=useState("All");const [resolved,setResolved]=useState<string[]>([]);
  const [reportClientId,setReportClientId]=useState(clients[0]?.id||"");const [reportRows,setReportRows]=useState<any[]>([]);
  const [reportLoading,setReportLoading]=useState(false);const [reportError,setReportError]=useState("");
  const title=navTitle(section);const searchRows=(rows:any[])=>rows.filter(r=>JSON.stringify(r).toLowerCase().includes(query.toLowerCase()));
  useEffect(()=>{if(!reportClientId&&clients[0]?.id)setReportClientId(clients[0].id);},[clients,reportClientId]);
  useEffect(()=>{
    if(!isAuthenticated||!dbClient||!organizationId||!reportClientId||!["trial-balance","profit-loss","balance-sheet"].includes(section)){setReportRows([]);return;}
    let active=true;setReportLoading(true);setReportError("");
    const ranges:any={"Oct 2026":{start:"2026-10-01",end:"2026-10-31"},"Sep 2026":{start:"2026-09-01",end:"2026-09-30"},"Q2 FY 2026–27":{start:"2026-07-01",end:"2026-09-30"},"FY 2026–27":{start:"2026-04-01",end:"2027-03-31"}};
    const range=ranges[period]||ranges["Oct 2026"];
    const call=section==="trial-balance"?dbClient.rpc("get_trial_balance",{p_organization_id:organizationId,p_client_id:reportClientId,p_as_of_date:range.end}):section==="profit-loss"?dbClient.rpc("get_profit_and_loss",{p_organization_id:organizationId,p_client_id:reportClientId,p_period_start:range.start,p_period_end:range.end}):dbClient.rpc("get_balance_sheet",{p_organization_id:organizationId,p_client_id:reportClientId,p_as_of_date:range.end});
    call.then(({data,error}:any)=>{if(!active)return;if(error){setReportError(error.message);setReportRows([]);}else setReportRows(data??[]);setReportLoading(false);});
    return()=>{active=false;};
  },[section,isAuthenticated,dbClient,organizationId,reportClientId,period]);
  const runJournalAction=async(entry:any,action:"submit"|"approve"|"post")=>{
    if(!dbClient||!organizationId)return;
    const fn=action==="submit"?"submit_journal_for_review":action==="approve"?"approve_journal":"post_approved_journal";
    const {error}=await dbClient.rpc(fn,{p_organization_id:organizationId,p_journal_entry_id:entry.id});
    if(error){notify("Journal action failed: "+error.message);return;}
    notify(action==="submit"?"Journal submitted for review.":action==="approve"?"Journal approved.":"Journal posted to the ledger.");
    await onJournalRefresh?.();
  };
  const renderTable=(headers:string[],rows:any[],keys:string[])=> <div className="table-scroll"><table className="data-table"><thead><tr>{headers.map(h=><th key={h}>{h.toUpperCase()}</th>)}</tr></thead><tbody>{searchRows(rows).map((r:any,i)=><tr key={r.id||i} onClick={()=>setSelected(r)} className="click-row">{keys.map((k,j)=><td key={k}>{k==="amount"||k==="turnover"||k==="gross"||k==="statement"||k==="book"||k==="books"||k==="gstr2b"||k==="taxable"||k==="debit"||k==="credit"?inr(r[k]||0):k==="status"?<Status value={r[k]}/>:String(r[k]??"—")}</td>)}</tr>)}</tbody></table>{!rows.length&&<div className="empty-state">No records in this demo view.</div>}</div>;
  const headerActions=<><button className="btn btn-quiet" onClick={()=>exportCsv(section==="banking"?bankStatementLines:transactions,section==="banking"?"aurel-bank-statement-lines.csv":"aurel-transactions.csv")}><Download size={14}/> Export</button><button className="btn btn-primary" onClick={()=>setModal(section==="clients"?"client":section==="documents"?"upload":section==="transactions"||section==="banking"?"import":section==="journals"?"journal":"generic")}><Plus size={15}/> {section==="clients"?"Add client":section==="documents"?"Upload file":section==="banking"?"Import statement":section==="transactions"?"Import CSV":section==="journals"?"New journal":"New draft"}</button></>;
  return <div className="module-page animate-in"><div className="page-heading"><div><div className="eyebrow">AUREL WORKSPACE <span className="heading-dot"/> SAMPLE DATA</div><h1>{title}<span className="heading-period">.</span></h1><p>{moduleDescription(section)}</p></div><div className="heading-actions">{headerActions}</div></div>
    <div className="module-context"><span className="context-pill"><CalendarDays size={13}/> FY 2026–27</span><span className="coverage-text"><ShieldCheck size={13}/> {isAuthenticated ? "Prototype workbench · live tax/accounting services not connected" : "Demo mode · no external provider connected"}</span></div>
    {section==="clients"&&<><div className="mini-stats"><MiniStat label="Total client entities" value={String(clients.length)} sub="Across demo workspace"/><MiniStat label="Active clients" value={String(clients.filter((c:any)=>c.status==="Active").length)} sub="Engagements in progress"/><MiniStat label="Onboarding" value={String(clients.filter((c:any)=>c.status==="Onboarding").length)} sub="Awaiting source information"/><MiniStat label="Open client tasks" value={String(clients.reduce((a:number,c:any)=>a+c.tasks,0))} sub="Across all entities"/></div><section className="panel table-panel"><TableToolbar query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} filters={["All","Active","Review","Onboarding"]}/>{renderTable(["Client / Entity","Entity type","GSTIN (masked)","State","Annual turnover","Owner","Status"],clients.map((c:any)=>({...c,gstin:mask(c.gstin)})),["name","type","gstin","state","turnover","owner","status"])}</section><div className="footer-note">Each client workspace keeps source documents, books, GST, tax workpapers, tasks and archive under one entity record.</div></>}
    {section==="documents"&&<><div className="document-drop"><div className="drop-icon"><Upload size={20}/></div><div><b>Drop invoices, receipts or statements here</b><span>PDF, JPG, PNG, CSV or XLSX · {isAuthenticated ? "private organisation storage" : "demo upload only"}</span></div><label className="btn btn-primary">Choose files<input hidden type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.csv,.xlsx" onChange={e=>uploadDocs(e.target.files)}/></label></div><div className="mini-stats"><MiniStat label="Inbox items" value={String(documents.length)} sub="Recent uploads"/><MiniStat label="Needs review" value={String(documents.filter((d:any)=>d.status==="Needs review"||d.status==="Uploaded").length)} sub="Human validation required"/><MiniStat label="Approved" value={String(documents.filter((d:any)=>d.status==="Approved").length)} sub="Extraction accepted"/><MiniStat label="Average confidence" value={isAuthenticated ? "—" : "91.8%"} sub={isAuthenticated ? "OCR service not connected" : "Illustrative extraction score"}/></div><section className="panel table-panel"><TableToolbar query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} filters={["All","Needs review","Approved","Uploaded"]}/>{renderTable(["Document","Counterparty","Type","Date","Amount","Confidence","Status"],documents,["name","party","kind","date","amount","confidence","status"])}</section><div className="review-note"><Sparkles size={15}/><div><b>Extraction is a proposal, not an approved accounting fact.</b><span>Review supplier, GSTIN, invoice number, taxable amount and tax split before creating a book entry.</span></div><button className="text-link" onClick={()=>notify("Extraction review opened for selected demo document.")}>Review sample <ArrowRight size={13}/></button></div></>}
    {section==="banking"&&<><div className="mini-stats"><MiniStat label="Statement lines" value={isAuthenticated?String(bankStatementLines.length):String(recon.length)} sub={isAuthenticated?"Persisted source rows":"Illustrative bank rows"}/><MiniStat label="Debits" value={isAuthenticated?inr(bankStatementLines.reduce((s:number,r:any)=>s+r.debit,0)):inr(recon.reduce((s:number,r:any)=>s+Math.max(0,r.statement),0))} sub="Imported outflow evidence"/><MiniStat label="Credits" value={isAuthenticated?inr(bankStatementLines.reduce((s:number,r:any)=>s+r.credit,0)):"—"} sub="Not automatically classified as revenue"/><MiniStat label="Import batches" value={isAuthenticated?String(new Set(bankStatementLines.map((r:any)=>r.import_id)).size):"Demo"} sub="Stable file-level identifiers"/></div><section className="panel table-panel"><div className="panel-head"><div><div className="eyebrow">BANK STATEMENT REGISTER</div><h3>{isAuthenticated?"Imported statement evidence":"Sample statement preview"}</h3><p>{isAuthenticated?"Source rows are retained separately from canonical cash events. Account assignment and reconciliation are later steps.":"Illustrative data only."}</p></div><button className="btn btn-primary" onClick={()=>setModal("import")}><Upload size={14}/> Import CSV</button></div>{isAuthenticated?renderTable(["External row ID","Date","Narration","Direction","Debit","Credit","Import ID"],bankStatementLines,["id","date","narration","direction","debit","credit","import_id"]):renderTable(["Bank reference","Date","Narration","Direction","Statement amount","Book amount","Status"],recon.map((r:any)=>({...r,direction:r.statement>=0?"Debit":"Credit",amount:Math.abs(r.statement)})),["id","date","description","direction","amount","book","status"])}</section><div className="footer-note">Imported lines are evidence of bank movement, not accounting classification. AUREL does not infer sales, expenses or tax treatment from a bank narration alone.</div></>}
    {section==="transactions"&&<><div className="mini-stats"><MiniStat label="Operating inflows" value={isAuthenticated ? "—" : "₹42.80L"} sub={isAuthenticated ? "Live metric service not connected" : "October demo period"}/><MiniStat label="Operating outflows" value={isAuthenticated ? "—" : "₹18.60L"} sub={isAuthenticated ? "Live metric service not connected" : "October demo period"}/><MiniStat label="Processor fees" value={isAuthenticated ? "—" : "₹11,165"} sub={isAuthenticated ? "PayPal adapter not connected" : "Separated from net receipts"}/><MiniStat label="Needs review" value={isAuthenticated ? "—" : "1"} sub={isAuthenticated ? "Exception engine not connected" : "Cash movement exception"}/></div><section className="panel table-panel"><TableToolbar query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} filters={["All","in","out","Needs review","Reconciled"]}/>{renderTable(["Transaction ID","Date","Counterparty","Description","Direction","Gross","Fee","Source","Status"],searchRows(transactions).filter((t:any)=>filter==="All"||t.direction===filter||t.status===filter),["id","date","party","description","direction","gross","fee","source","status"])}</section><div className="footer-note">Bills, receipt evidence and actual payment events are separate records. The matching process links them without creating duplicate expenses.</div></>}
    {section==="reconciliation"&&<><div className="mini-stats"><MiniStat label="Statement lines" value={isAuthenticated ? "—" : "128"} sub={isAuthenticated ? "No bank statement imported" : "HDFC · October 2026"}/><MiniStat label="Auto-matched" value={isAuthenticated ? "—" : "119"} sub={isAuthenticated ? "Matching engine not connected" : "High confidence matches"}/><MiniStat label="Needs review" value={String(recon.filter((r:any)=>r.status!=="Matched").length)} sub="Human decision needed"/><MiniStat label="Variance detected" value={isAuthenticated ? "—" : "₹500"} sub={isAuthenticated ? "No reconciliation result" : "Illustrative exception"}/></div><section className="panel table-panel"><TableToolbar query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} filters={["All","Matched","Suggested","Amount mismatch","Missing in books"]}/>{renderTable(["Bank reference","Date","Statement narration","Statement amount","Book amount","Status"],recon.filter((r:any)=>filter==="All"||r.status===filter),["id","date","description","statement","book","status"])}</section><div className="review-note"><GitCompareArrows size={15}/><div><b>Reconciliation decisions are auditable.</b><span>Accepting a suggestion changes the match status only in this demo session.</span></div><button className="btn btn-quiet" onClick={()=>{setRecon(recon.map((r:any)=>r.status==="Suggested"?{...r,status:"Matched"}:r));notify("Suggested match accepted in demo session.");}}>Accept suggested matches</button></div></>}
    {section==="gst"&&<><div className="mini-stats"><MiniStat label="Output tax working" value="₹6.42L" sub="Illustrative, October"/><MiniStat label="Eligible ITC working" value="₹4.18L" sub="Subject to verification"/><MiniStat label="Net liability working" value="₹2.24L" sub="Before authorised review"/><MiniStat label="Workpaper status" value="In review" sub="Reviewer action pending"/></div><div className="tab-row">{["Overview","GSTR-1","GSTR-3B","Purchase register","Sales register"].map(x=><button className={tab===x?"tab-active":""} onClick={()=>setTab(x)} key={x}>{x}</button>)}</div><section className="panel workpaper-panel"><div className="panel-head"><div><div className="eyebrow">GST WORKPAPER · OCTOBER 2026</div><h3>{tab==="Overview"?"Return preparation summary":tab+" preparation"}</h3><p>Illustrative workpaper values · verify applicability and current rules.</p></div><Status value="In review"/></div><div className="workpaper-grid"><div><span>Outward taxable supplies</span><b>₹35,62,400</b><small>Based on sample sales register</small></div><div><span>Output GST</span><b>₹6,41,232</b><small>Tax calculation preview</small></div><div><span>Purchase ITC working</span><b>₹4,18,140</b><small>Subject to GSTR-2B match</small></div><div><span>Net liability working</span><b>₹2,23,092</b><small>Not a filing amount</small></div></div><div className="review-note"><AlertCircle size={15}/><div><b>Preparation only — not filed.</b><span>Final return preparation requires current period rules, taxpayer review and authorised filing/verification.</span></div><button className="btn btn-quiet" onClick={()=>notify("GST workpaper preview exported in demo mode.")}>Preview workpaper</button></div></section></>}
    {section==="itc"&&<><div className="mini-stats"><MiniStat label="Matched invoices" value="84" sub="88.4% of register"/><MiniStat label="Exceptions" value="7" sub="Reviewer queue"/><MiniStat label="Potential ITC at risk" value="₹38,420" sub="Not a claim determination"/><MiniStat label="Last reconciliation" value="09 Nov" sub="Demo data"/></div><section className="panel table-panel"><div className="panel-head"><div><div className="eyebrow">PURCHASE REGISTER VS BOOKS VS GSTR-2B</div><h3>ITC exception workbench</h3><p>Each exception has a reason, owner and evidence trail.</p></div><Status value="7 open"/></div>{renderTable(["Supplier","GSTIN","Invoice","Books amount","GSTR-2B","Status","Owner"],[{id:"ITC-01",party:"Vardhman Trims",gstin:"27•••••••••1Z4",invoiceNo:"VT-221",books:rupees(84200),gstr2b:rupees(0),status:"Missing in 2B",owner:"Priya Nair"},{id:"ITC-02",party:"Surat Yarn House",gstin:"27•••••••••1Z2",invoiceNo:"PY-2291",books:rupees(186400),gstr2b:rupees(185900),status:"Amount mismatch",owner:"Rahul Iyer"},{id:"ITC-03",party:"Lotus Packaging",gstin:"27•••••••••1Z8",invoiceNo:"LP-088",books:rupees(42600),gstr2b:rupees(42600),status:"Matched",owner:"Priya Nair" }],["party","gstin","invoiceNo","books","gstr2b","status","owner"])}</section><div className="review-note"><ShieldCheck size={15}/><div><b>ITC is not automatically claimed.</b><span>Exceptions must be investigated against invoice evidence and applicable law before reviewer approval.</span></div><button className="btn btn-quiet" onClick={()=>notify("Exception review opened. Demo resolution only.")}>Resolve exception</button></div></>}
    {section==="journals"&&<><div className="mini-stats"><MiniStat label="Draft journals" value={isAuthenticated?String(journalEntries.filter((j:any)=>j.lifecycle_status==="draft").length):"12"} sub={isAuthenticated?"Persisted draft entries":"Demo workspace"}/><MiniStat label="Awaiting review" value={isAuthenticated?String(journalEntries.filter((j:any)=>j.lifecycle_status==="pending_review").length):"3"} sub="Preparer submissions"/><MiniStat label="Approved" value={isAuthenticated?String(journalEntries.filter((j:any)=>j.lifecycle_status==="approved").length):"—"} sub="Awaiting posting"/><MiniStat label="Posted" value={isAuthenticated?String(journalEntries.filter((j:any)=>j.lifecycle_status==="posted").length):"48"} sub={isAuthenticated?"Immutable ledger entries":"Illustrative ledger"}/></div><section className="panel table-panel"><TableToolbar query={query} setQuery={setQuery} filter={filter} setFilter={setFilter}/>{renderTable(["Journal ID","Date","Narration","Source","Debit total","Credit total","Status"],isAuthenticated?journalEntries:[{id:"JV-0412",date:"09 Nov 2026",narration:"October expense accrual",source:"Manual draft",debit:rupees(10000),credit:rupees(10000),status:"Balanced draft"},{id:"JV-0411",date:"08 Nov 2026",narration:"PayPal settlement fee",source:"PayPal demo",debit:rupees(11165),credit:rupees(11165),status:"Posted"},{id:"JV-0410",date:"07 Nov 2026",narration:"MSEDCL electricity expense",source:"Document DOC-181",debit:rupees(42650),credit:rupees(42650),status:"Pending approval"}],["journal_number","date","narration","source","debit","credit","status"])}</section>{isAuthenticated&&journalEntries.filter((j:any)=>["draft","pending_review","approved"].includes(j.lifecycle_status)).map((entry:any)=><div className="review-note" key={entry.id}><FileCheck2 size={15}/><div><b>{entry.journal_number} · {entry.status}</b><span>{entry.narration} · Debit {inr(entry.debit)} / Credit {inr(entry.credit)}</span></div>{entry.lifecycle_status==="draft"&&<button className="btn btn-quiet" onClick={()=>runJournalAction(entry,"submit")}>Submit for review</button>}{entry.lifecycle_status==="pending_review"&&<button className="btn btn-quiet" onClick={()=>runJournalAction(entry,"approve")}>Approve</button>}{entry.lifecycle_status==="approved"&&<button className="btn btn-primary" onClick={()=>runJournalAction(entry,"post")}>Post journal</button>}</div>)}<div className="footer-note">Draft → Pending review → Approved → Posted. Posted journals are immutable; corrections require reversal or adjustment entries.</div></>}
    {section==="tasks"&&<><div className="mini-stats"><MiniStat label="Open tasks" value={String(tasks.filter((t:any)=>t.status!=="Done").length)} sub="Across current clients"/><MiniStat label="High priority" value="2" sub="Resolve before close"/><MiniStat label="Awaiting review" value={String(tasks.filter((t:any)=>t.status==="Awaiting review").length)} sub="Reviewer queue"/><MiniStat label="Blocked" value={String(tasks.filter((t:any)=>t.status==="Blocked").length)} sub="Client information needed"/></div><section className="panel table-panel">{renderTable(["Task","Client","Due","Assignee","Priority","Status"],tasks,["title","client","due","assignee","priority","status"])}</section><div className="review-note"><ListChecks size={15}/><div><b>Workflow automation</b><span>Assignment, review and approval controls are represented with sample data.</span></div><button className="btn btn-quiet" onClick={()=>{setTasks(tasks.map((t:any)=>t.status==="In progress"?{...t,status:"Done"}:t));notify("In-progress sample tasks marked done.");}}>Complete in-progress</button></div></>}
    {section==="integrations"&&<div className="integration-grid"><IntegrationCard name="PayPal" desc="Checkout, order capture, refunds and transaction activity." status="Not connected" icon={<Banknote size={19}/>} note="Sandbox integration target. Credentials are not configured."/><IntegrationCard name="Bank statement CSV" desc="Import HDFC, ICICI and other supported statement exports." status="Available · file import" icon={<Landmark size={19}/>} note="No bank login or credentials are collected."/><IntegrationCard name="GSTN / GSP" desc="Prepare and reconcile GST data through authorised provider paths." status="Not connected" icon={<ShieldCheck size={19}/>} note="No GST filing or scraping is active in this prototype."/><IntegrationCard name="Document intelligence" desc="Classify documents and extract invoice fields for review." status="Demo extraction" icon={<FileImage size={19}/>} note="Real OCR requires secure server-side processing."/><IntegrationCard name="Accounting imports" desc="Bring source records from accounting exports." status="Planned" icon={<BookOpen size={19}/>} note="Provider mappings and validation tests are required."/><IntegrationCard name="AI tools" desc="AUREL Agent with cited, read-only financial tools." status="Demo responses" icon={<Sparkles size={19}/>} note="No live model connection is claimed." /></div>}
    {section==="insights"||section==="forecasts"||section==="anomalies"||section==="reports"?<><div className="mini-stats"><MiniStat label="Revenue growth" value="+18.4%" sub="October vs previous month"/><MiniStat label="Operating spend ratio" value="43.5%" sub="Cash outflow / cash inflow"/><MiniStat label="Working capital" value="₹16.8L" sub="Illustrative current working"/><MiniStat label="Forecast horizon" value="90 days" sub="Scenario-based estimate"/></div><div className="content-grid primary-grid"><section className="panel cash-panel"><div className="panel-head"><div><div className="eyebrow">TREND ANALYSIS</div><h3>Operating movement</h3><p>Monthly inflow vs outflow · ₹ lakh</p></div></div><div className="chart-wrap large"><ResponsiveContainer width="100%" height="100%"><BarChart data={cashSeries}><CartesianGrid vertical={false} stroke="#e9ede8"/><XAxis dataKey="period" axisLine={false} tickLine={false}/><YAxis axisLine={false} tickLine={false}/><Tooltip/><Bar dataKey="inflow" fill="#24785f" radius={[4,4,0,0]}/><Bar dataKey="outflow" fill="#becbc3" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div></section><section className="panel spend-panel"><div className="panel-head"><div><div className="eyebrow">MODEL OBSERVATIONS</div><h3>Signals to review</h3></div></div><div className="insight-callout"><AlertTriangle size={16}/><div><b>Supplier concentration</b><span>Top supplier represents 28% of October purchases.</span></div></div><div className="insight-callout"><Activity size={16}/><div><b>Spend velocity</b><span>Cloud spend is 4.2% above its three-month average.</span></div></div><div className="insight-callout"><Wallet size={16}/><div><b>Cash forecast</b><span>Base case remains positive through the 90-day horizon.</span></div></div></section></div></>:null}
    {["trial-balance","profit-loss","balance-sheet"].includes(section)&&isAuthenticated&&<section className="panel table-panel"><div className="panel-head"><div><div className="eyebrow">{title.toUpperCase()} · POSTED LEDGER DATA</div><h3>{pageSubtitle(section)}</h3><p>Calculated from posted journal lines only. Draft and pending journals are excluded.</p></div><label className="report-client-select">Client<select value={reportClientId} onChange={e=>setReportClientId(e.target.value)}>{clients.map((c:any)=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label></div>{reportLoading?<div className="empty-state">Calculating from the posted ledger…</div>:reportError?<div className="review-note"><AlertCircle size={15}/><div><b>Report unavailable</b><span>{reportError}. Apply supabase/core-operations.sql and check Data API exposure for the public RPCs.</span></div></div>:reportRows.length===0?<div className="empty-state">No posted journal balances are available for this client and period yet.</div>:section==="trial-balance"?renderTable(["Account code","Account name","Group","Total debit","Total credit","Closing debit","Closing credit"],reportRows,["account_code","account_name","account_group","total_debits_minor","total_credits_minor","closing_debit_minor","closing_credit_minor"]):renderTable(["Account code","Account name","Group","Balance"],reportRows,["account_code","account_name","account_group","balance_minor"])}</section>}
    {["ledger","trial-balance","profit-loss","balance-sheet","cash-flow","banking","sales-purchases","payables-receivables","tds","income-tax","compliance","notices","archive","audit","team","settings"].includes(section)&&!(isAuthenticated&&["trial-balance","profit-loss","balance-sheet"].includes(section))&&<><div className="mini-stats"><MiniStat label="Current period" value={isAuthenticated?"—":"Oct 2026"} sub={isAuthenticated?"Live module not connected":"Demo reporting window"}/><MiniStat label="Records available" value={isAuthenticated?"—":"128"} sub={isAuthenticated?"Service not connected":"Illustrative source set"}/><MiniStat label="Review status" value={isAuthenticated?"Not configured":"In progress"} sub={isAuthenticated?"No live workflow":"Human sign-off required"}/><MiniStat label="Data lineage" value={isAuthenticated?"—":"92%"} sub={isAuthenticated?"No live source coverage":"Sample source coverage"}/></div><section className="panel table-panel"><div className="panel-head"><div><div className="eyebrow">{title.toUpperCase()} · {isAuthenticated?"LIVE WORKSPACE STATUS":"SAMPLE WORKSPACE"}</div><h3>{pageSubtitle(section)}</h3><p>{isAuthenticated?"This module is not connected to a live accounting, tax or compliance service yet. No sample figures are shown in this session.":"Interactive sample view. Amounts and statuses are illustrative."}</p></div><Status value={isAuthenticated?"Not connected":"Demo data"}/></div>{renderTable(["Reference","Description","Period","Amount","Owner","Status"],isAuthenticated?[]:[{id:"AUR-201",description:"Opening balance / brought forward",date:"01 Oct 2026",amount:rupees(1250000),owner:"System",status:"Reviewed"},{id:"AUR-202",description:"Operating activity — October",date:"31 Oct 2026",amount:rupees(4280000),owner:"Ananya Sen",status:"Needs review"},{id:"AUR-203",description:"Tax / compliance workpaper",date:"09 Nov 2026",amount:rupees(224000),owner:"Priya Nair",status:"In progress"}],["id","description","date","amount","owner","status"])}</section></>}
  </div>;
}
function MiniStat({label,value,sub}:any){return <div className="mini-stat"><span>{label}</span><b>{value}</b><small>{sub}</small></div>;}
function TableToolbar({query,setQuery,filter,setFilter,filters=["All"]}:any){return <div className="table-toolbar"><div className="table-search"><Search size={14}/><input placeholder="Search records..." value={query} onChange={e=>setQuery(e.target.value)}/></div><div className="table-filters"><Filter size={14}/><select value={filter} onChange={e=>setFilter(e.target.value)}>{filters.map((f:string)=><option key={f}>{f}</option>)}</select><button className="icon-btn" title="More filters"><MoreHorizontal size={17}/></button></div></div>;}
function IntegrationCard({name,desc,status,icon,note}:any){return <div className="panel integration-card"><div className="integration-top"><div className="integration-icon">{icon}</div><Status value={status}/></div><h3>{name}</h3><p>{desc}</p><div className="integration-note">{note}</div><button className="btn btn-quiet" disabled={status==="Not connected"||status==="Planned"}>Configure <ArrowRight size={13}/></button></div>;}
function moduleDescription(section:string){const descriptions:any={clients:"One master profile for every entity. Reuse verified information across books, GST, tax workpapers and reports.",documents:"A single inbox for bills, invoices, receipts, statements and notices — with extraction review before records are approved.",transactions:"A unified timeline for cash movement across bank, card, PayPal and manual sources.", "sales-purchases":"Manage sales invoices, supplier bills, credit notes and settlement status in one place.",banking:"Review connected accounts and imported statement activity without sharing bank login credentials.", "payables-receivables":"See who owes the business, what the business owes, and when cash is expected to move.",ledger:"Trace posted accounting activity back to its originating source and journal.",journals:"Prepare balanced double-entry journals with controlled review and posting.", "trial-balance":"Review debit and credit balances before month-end close.","profit-loss":"Understand accrual-based income and expenditure from verified ledger data.","balance-sheet":"Review assets, liabilities and equity at a point in time.","cash-flow":"Separate operating, investing and financing cash movements.","reconciliation":"Match statement activity against books, invoices and payments with exception review.",gst:"Prepare GST workpapers, liability workings and return-ready review packs.","itc":"Compare purchase register, books and GSTR-2B to investigate eligible-credit exceptions.",tds:"Track withholding, credits and return workpapers with source-backed review.","income-tax":"Organise taxpayer sources and build reviewable tax-computation workpapers.",compliance:"Track tasks and statutory dates with applicability checks and evidence.",notices:"Organise notices, extract key fields and prepare review checklists.",insights:"Explore business performance, concentration, margins and spend drivers.",forecasts:"Review scenario-based cash-in and cash-out outlooks.",anomalies:"Investigate unusual amounts, duplicate candidates and unexpected timing.",reports:"Generate versioned operational, accounting and compliance review packs.",tasks:"Coordinate preparers, reviewers, approvals and client follow-ups.",audit:"Trace who changed what, when, and against which supporting evidence.",archive:"Find prior-period reports, workpapers and evidence snapshots.",integrations:"Connect financial sources through secure, authorised provider workflows.",team:"Control roles, client scope and sensitive data visibility.",settings:"Configure organisation defaults, financial years and operating preferences."};return descriptions[section]||"AUREL turns verified source records into actionable business intelligence.";}
function pageSubtitle(section:string){const x:any={ledger:"General ledger activity", "trial-balance":"Trial balance overview","profit-loss":"Statement of profit and loss","balance-sheet":"Statement of financial position","cash-flow":"Cash flow statement",banking:"Bank accounts and statement feeds","sales-purchases":"Trade documents and settlement register","payables-receivables":"Ageing and outstanding balances",tds:"TDS / TCS workpaper status","income-tax":"Income tax source register",compliance:"Upcoming compliance work","notices":"Notice intake and response workflow",archive:"Archived reports and workpapers",audit:"Chronological action history",team:"Workspace members and access scopes",settings:"Organisation and period preferences"};return x[section]||"Operational workspace";}
