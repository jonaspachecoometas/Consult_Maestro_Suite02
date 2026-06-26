import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { 
  Plus, 
  Trash2, 
  Edit, 
  TrendingUp, 
  Users, 
  DollarSign, 
  Loader2, 
  Phone, 
  Mail, 
  Building2,
  ArrowRight,
  UserPlus,
  Briefcase,
  Calendar,
  MoreVertical,
  Percent,
  FileText,
  FileSignature,
  Handshake,
  Send,
  Check,
  X,
  Clock
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { CrmLead, CrmOpportunity, CrmPipelineStage, Client, CrmProposal, CrmProposalItem, CrmContract, CrmContractMilestone, CrmPartner } from "@shared/schema";

type LeadStatus = 'new' | 'contacted' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost' | 'converted';

const leadStatusConfig: Record<LeadStatus, { label: string; color: string }> = {
  new: { label: 'Novo', color: 'bg-blue-500' },
  contacted: { label: 'Contatado', color: 'bg-yellow-500' },
  qualified: { label: 'Qualificado', color: 'bg-purple-500' },
  proposal: { label: 'Proposta', color: 'bg-indigo-500' },
  negotiation: { label: 'Negociação', color: 'bg-orange-500' },
  won: { label: 'Ganho', color: 'bg-green-500' },
  lost: { label: 'Perdido', color: 'bg-red-500' },
  converted: { label: 'Convertido', color: 'bg-emerald-500' },
};

type ProposalStatus = 'draft' | 'sent' | 'negotiation' | 'approved' | 'rejected' | 'expired';

const proposalStatusConfig: Record<ProposalStatus, { label: string; color: string }> = {
  draft: { label: 'Rascunho', color: 'bg-gray-500' },
  sent: { label: 'Enviada', color: 'bg-blue-500' },
  negotiation: { label: 'Negociação', color: 'bg-orange-500' },
  approved: { label: 'Aprovada', color: 'bg-green-500' },
  rejected: { label: 'Rejeitada', color: 'bg-red-500' },
  expired: { label: 'Expirada', color: 'bg-gray-400' },
};

type ContractStatus = 'draft' | 'pending_signature' | 'active' | 'completed' | 'cancelled';

const contractStatusConfig: Record<ContractStatus, { label: string; color: string }> = {
  draft: { label: 'Rascunho', color: 'bg-gray-500' },
  pending_signature: { label: 'Aguardando Assinatura', color: 'bg-yellow-500' },
  active: { label: 'Ativo', color: 'bg-green-500' },
  completed: { label: 'Concluído', color: 'bg-blue-500' },
  cancelled: { label: 'Cancelado', color: 'bg-red-500' },
};

type PartnerType = 'referral' | 'service' | 'reseller' | 'affiliate';
type PartnerStatus = 'pending' | 'active' | 'inactive';

const partnerTypeConfig: Record<PartnerType, { label: string }> = {
  referral: { label: 'Indicador' },
  service: { label: 'Serviços' },
  reseller: { label: 'Revendedor' },
  affiliate: { label: 'Afiliado' },
};

const partnerStatusConfig: Record<PartnerStatus, { label: string; color: string }> = {
  pending: { label: 'Pendente', color: 'bg-yellow-500' },
  active: { label: 'Ativo', color: 'bg-green-500' },
  inactive: { label: 'Inativo', color: 'bg-gray-500' },
};

export default function Crm() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('pipeline');
  const [isNewLeadOpen, setIsNewLeadOpen] = useState(false);
  const [isNewOpportunityOpen, setIsNewOpportunityOpen] = useState(false);
  const [isEditLeadOpen, setIsEditLeadOpen] = useState(false);
  const [isEditOpportunityOpen, setIsEditOpportunityOpen] = useState(false);
  const [isDeleteLeadOpen, setIsDeleteLeadOpen] = useState(false);
  const [isDeleteOpportunityOpen, setIsDeleteOpportunityOpen] = useState(false);
  const [isConvertLeadOpen, setIsConvertLeadOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<CrmLead | null>(null);
  const [selectedOpportunity, setSelectedOpportunity] = useState<CrmOpportunity | null>(null);
  const [selectedProposal, setSelectedProposal] = useState<CrmProposal | null>(null);
  const [selectedContract, setSelectedContract] = useState<CrmContract | null>(null);
  
  const [isNewProposalOpen, setIsNewProposalOpen] = useState(false);
  const [isEditProposalOpen, setIsEditProposalOpen] = useState(false);
  const [isDeleteProposalOpen, setIsDeleteProposalOpen] = useState(false);
  const [isNewContractOpen, setIsNewContractOpen] = useState(false);
  const [isEditContractOpen, setIsEditContractOpen] = useState(false);
  const [isDeleteContractOpen, setIsDeleteContractOpen] = useState(false);
  
  const [isNewPartnerOpen, setIsNewPartnerOpen] = useState(false);
  const [isEditPartnerOpen, setIsEditPartnerOpen] = useState(false);
  const [isDeletePartnerOpen, setIsDeletePartnerOpen] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState<CrmPartner | null>(null);

  const [leadForm, setLeadForm] = useState({
    name: '',
    company: '',
    email: '',
    phone: '',
    industry: '',
    source: '',
    status: 'new' as LeadStatus,
    notes: '',
  });

  const [opportunityForm, setOpportunityForm] = useState({
    title: '',
    description: '',
    value: '',
    probability: '50',
    expectedCloseDate: '',
    stageId: '',
    clientId: '',
    leadId: '',
  });

  const [proposalForm, setProposalForm] = useState({
    title: '',
    description: '',
    opportunityId: '',
    clientId: '',
    partnerId: '',
    totalValue: '',
    validUntil: '',
    terms: '',
    notes: '',
  });

  const [contractForm, setContractForm] = useState({
    title: '',
    proposalId: '',
    opportunityId: '',
    clientId: '',
    startDate: '',
    endDate: '',
    totalValue: '',
    terms: '',
  });

  const [partnerForm, setPartnerForm] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    type: 'referral' as PartnerType,
    status: 'pending' as PartnerStatus,
    defaultCommissionRate: '10',
    notes: '',
  });

  const { data: stages = [], isLoading: isLoadingStages } = useQuery<CrmPipelineStage[]>({
    queryKey: ['/api/crm/pipeline-stages'],
  });

  const { data: leads = [], isLoading: isLoadingLeads } = useQuery<CrmLead[]>({
    queryKey: ['/api/crm/leads'],
  });

  const { data: opportunities = [], isLoading: isLoadingOpportunities } = useQuery<CrmOpportunity[]>({
    queryKey: ['/api/crm/opportunities'],
  });

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['/api/clients'],
  });

  const { data: proposals = [], isLoading: isLoadingProposals } = useQuery<CrmProposal[]>({
    queryKey: ['/api/crm/proposals'],
  });

  const { data: contracts = [], isLoading: isLoadingContracts } = useQuery<CrmContract[]>({
    queryKey: ['/api/crm/contracts'],
  });

  const { data: partners = [], isLoading: isLoadingPartners } = useQuery<CrmPartner[]>({
    queryKey: ['/api/crm/partners'],
  });

  const { data: stats } = useQuery<{
    totalLeads: number;
    leadsByStatus: Record<string, number>;
    totalOpportunities: number;
    totalPipelineValue: number;
    weightedPipelineValue: number;
    opportunitiesByStage: Record<string, { count: number; value: number }>;
    stages: CrmPipelineStage[];
  }>({
    queryKey: ['/api/crm/stats'],
  });

  const seedStagesMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', '/api/crm/pipeline-stages/seed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/crm/pipeline-stages'] });
      queryClient.invalidateQueries({ queryKey: ['/api/crm/stats'] });
      toast({ title: 'Etapas do pipeline criadas com sucesso' });
    },
  });

  useEffect(() => {
    if (stages.length === 0 && !isLoadingStages) {
      seedStagesMutation.mutate();
    }
  }, [stages, isLoadingStages]);

  const createLeadMutation = useMutation({
    mutationFn: async (data: typeof leadForm) => {
      return apiRequest('POST', '/api/crm/leads', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/crm/leads'] });
      queryClient.invalidateQueries({ queryKey: ['/api/crm/stats'] });
      toast({ title: 'Lead criado com sucesso' });
      setIsNewLeadOpen(false);
      resetLeadForm();
    },
    onError: () => {
      toast({ title: 'Erro ao criar lead', variant: 'destructive' });
    },
  });

  const updateLeadMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<typeof leadForm> }) => {
      return apiRequest('PATCH', `/api/crm/leads/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/crm/leads'] });
      queryClient.invalidateQueries({ queryKey: ['/api/crm/stats'] });
      toast({ title: 'Lead atualizado com sucesso' });
      setIsEditLeadOpen(false);
      setSelectedLead(null);
    },
    onError: () => {
      toast({ title: 'Erro ao atualizar lead', variant: 'destructive' });
    },
  });

  const deleteLeadMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/crm/leads/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/crm/leads'] });
      queryClient.invalidateQueries({ queryKey: ['/api/crm/stats'] });
      toast({ title: 'Lead excluído com sucesso' });
      setIsDeleteLeadOpen(false);
      setSelectedLead(null);
    },
    onError: () => {
      toast({ title: 'Erro ao excluir lead', variant: 'destructive' });
    },
  });

  const convertLeadMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('POST', `/api/crm/leads/${id}/convert`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/crm/leads'] });
      queryClient.invalidateQueries({ queryKey: ['/api/clients'] });
      queryClient.invalidateQueries({ queryKey: ['/api/crm/stats'] });
      toast({ title: 'Lead convertido em cliente com sucesso' });
      setIsConvertLeadOpen(false);
      setSelectedLead(null);
    },
    onError: () => {
      toast({ title: 'Erro ao converter lead', variant: 'destructive' });
    },
  });

  const createOpportunityMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest('POST', '/api/crm/opportunities', {
        ...data,
        value: data.value ? parseFloat(data.value) : null,
        probability: data.probability ? parseInt(data.probability) : null,
        expectedCloseDate: data.expectedCloseDate ? new Date(data.expectedCloseDate) : null,
        clientId: data.clientId || null,
        leadId: data.leadId || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/crm/opportunities'] });
      queryClient.invalidateQueries({ queryKey: ['/api/crm/stats'] });
      toast({ title: 'Oportunidade criada com sucesso' });
      setIsNewOpportunityOpen(false);
      resetOpportunityForm();
    },
    onError: () => {
      toast({ title: 'Erro ao criar oportunidade', variant: 'destructive' });
    },
  });

  const updateOpportunityMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return apiRequest('PATCH', `/api/crm/opportunities/${id}`, {
        ...data,
        value: data.value ? parseFloat(data.value) : undefined,
        probability: data.probability ? parseInt(data.probability) : undefined,
        expectedCloseDate: data.expectedCloseDate ? new Date(data.expectedCloseDate) : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/crm/opportunities'] });
      queryClient.invalidateQueries({ queryKey: ['/api/crm/stats'] });
      toast({ title: 'Oportunidade atualizada com sucesso' });
      setIsEditOpportunityOpen(false);
      setSelectedOpportunity(null);
    },
    onError: () => {
      toast({ title: 'Erro ao atualizar oportunidade', variant: 'destructive' });
    },
  });

  const deleteOpportunityMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/crm/opportunities/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/crm/opportunities'] });
      queryClient.invalidateQueries({ queryKey: ['/api/crm/stats'] });
      toast({ title: 'Oportunidade excluída com sucesso' });
      setIsDeleteOpportunityOpen(false);
      setSelectedOpportunity(null);
    },
    onError: () => {
      toast({ title: 'Erro ao excluir oportunidade', variant: 'destructive' });
    },
  });

  const createProposalMutation = useMutation({
    mutationFn: async (data: typeof proposalForm) => {
      return apiRequest('POST', '/api/crm/proposals', {
        ...data,
        totalValue: data.totalValue ? parseFloat(data.totalValue) : null,
        validUntil: data.validUntil ? new Date(data.validUntil) : null,
        opportunityId: data.opportunityId || null,
        clientId: data.clientId || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/crm/proposals'] });
      toast({ title: 'Proposta criada com sucesso' });
      setIsNewProposalOpen(false);
      resetProposalForm();
    },
    onError: () => {
      toast({ title: 'Erro ao criar proposta', variant: 'destructive' });
    },
  });

  const updateProposalMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return apiRequest('PATCH', `/api/crm/proposals/${id}`, {
        ...data,
        totalValue: data.totalValue ? parseFloat(data.totalValue) : undefined,
        validUntil: data.validUntil ? new Date(data.validUntil) : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/crm/proposals'] });
      toast({ title: 'Proposta atualizada com sucesso' });
      setIsEditProposalOpen(false);
      setSelectedProposal(null);
    },
    onError: () => {
      toast({ title: 'Erro ao atualizar proposta', variant: 'destructive' });
    },
  });

  const deleteProposalMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/crm/proposals/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/crm/proposals'] });
      toast({ title: 'Proposta excluída com sucesso' });
      setIsDeleteProposalOpen(false);
      setSelectedProposal(null);
    },
    onError: () => {
      toast({ title: 'Erro ao excluir proposta', variant: 'destructive' });
    },
  });

  const convertProposalToProjectMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('POST', `/api/crm/proposals/${id}/convert-to-project`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/crm/proposals'] });
      queryClient.invalidateQueries({ queryKey: ['/api/projects'] });
      toast({ title: 'Projeto criado com sucesso', description: 'A proposta foi convertida em um projeto no backlog' });
    },
    onError: () => {
      toast({ title: 'Erro ao criar projeto', description: 'Verifique se a proposta tem um cliente associado', variant: 'destructive' });
    },
  });

  const createContractMutation = useMutation({
    mutationFn: async (data: typeof contractForm) => {
      return apiRequest('POST', '/api/crm/contracts', {
        ...data,
        totalValue: data.totalValue ? parseFloat(data.totalValue) : null,
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
        proposalId: data.proposalId || null,
        opportunityId: data.opportunityId || null,
        clientId: data.clientId || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/crm/contracts'] });
      toast({ title: 'Contrato criado com sucesso' });
      setIsNewContractOpen(false);
      resetContractForm();
    },
    onError: () => {
      toast({ title: 'Erro ao criar contrato', variant: 'destructive' });
    },
  });

  const updateContractMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return apiRequest('PATCH', `/api/crm/contracts/${id}`, {
        ...data,
        totalValue: data.totalValue ? parseFloat(data.totalValue) : undefined,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/crm/contracts'] });
      toast({ title: 'Contrato atualizado com sucesso' });
      setIsEditContractOpen(false);
      setSelectedContract(null);
    },
    onError: () => {
      toast({ title: 'Erro ao atualizar contrato', variant: 'destructive' });
    },
  });

  const deleteContractMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/crm/contracts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/crm/contracts'] });
      toast({ title: 'Contrato excluído com sucesso' });
      setIsDeleteContractOpen(false);
      setSelectedContract(null);
    },
    onError: () => {
      toast({ title: 'Erro ao excluir contrato', variant: 'destructive' });
    },
  });

  const createPartnerMutation = useMutation({
    mutationFn: async (data: typeof partnerForm) => {
      return apiRequest('POST', '/api/crm/partners', {
        ...data,
        defaultCommissionRate: parseInt(data.defaultCommissionRate) || 10,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/crm/partners'] });
      toast({ title: 'Parceiro comercial criado com sucesso' });
      setIsNewPartnerOpen(false);
      resetPartnerForm();
    },
    onError: () => {
      toast({ title: 'Erro ao criar parceiro comercial', variant: 'destructive' });
    },
  });

  const updatePartnerMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<typeof partnerForm> }) => {
      return apiRequest('PATCH', `/api/crm/partners/${id}`, {
        ...data,
        defaultCommissionRate: data.defaultCommissionRate ? parseInt(data.defaultCommissionRate) : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/crm/partners'] });
      toast({ title: 'Parceiro comercial atualizado com sucesso' });
      setIsEditPartnerOpen(false);
      setSelectedPartner(null);
      resetPartnerForm();
    },
    onError: () => {
      toast({ title: 'Erro ao atualizar parceiro comercial', variant: 'destructive' });
    },
  });

  const deletePartnerMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/crm/partners/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/crm/partners'] });
      toast({ title: 'Parceiro comercial excluído com sucesso' });
      setIsDeletePartnerOpen(false);
      setSelectedPartner(null);
    },
    onError: () => {
      toast({ title: 'Erro ao excluir parceiro comercial', variant: 'destructive' });
    },
  });

  const resetLeadForm = () => {
    setLeadForm({
      name: '',
      company: '',
      email: '',
      phone: '',
      industry: '',
      source: '',
      status: 'new',
      notes: '',
    });
  };

  const resetOpportunityForm = () => {
    setOpportunityForm({
      title: '',
      description: '',
      value: '',
      probability: '50',
      expectedCloseDate: '',
      stageId: stages[0]?.id || '',
      clientId: '',
      leadId: '',
    });
  };

  const resetProposalForm = () => {
    setProposalForm({
      title: '',
      description: '',
      opportunityId: '',
      clientId: '',
      partnerId: '',
      totalValue: '',
      validUntil: '',
      terms: '',
      notes: '',
    });
  };

  const resetContractForm = () => {
    setContractForm({
      title: '',
      proposalId: '',
      opportunityId: '',
      clientId: '',
      startDate: '',
      endDate: '',
      totalValue: '',
      terms: '',
    });
  };

  const resetPartnerForm = () => {
    setPartnerForm({
      name: '',
      email: '',
      phone: '',
      company: '',
      type: 'referral',
      status: 'pending',
      defaultCommissionRate: '10',
      notes: '',
    });
  };

  const openEditPartner = (partner: CrmPartner) => {
    setSelectedPartner(partner);
    setPartnerForm({
      name: partner.name,
      email: partner.email || '',
      phone: partner.phone || '',
      company: partner.company || '',
      type: (partner.type || 'referral') as PartnerType,
      status: (partner.status || 'pending') as PartnerStatus,
      defaultCommissionRate: String(partner.defaultCommissionRate || 10),
      notes: partner.notes || '',
    });
    setIsEditPartnerOpen(true);
  };

  const openEditLead = (lead: CrmLead) => {
    setSelectedLead(lead);
    setLeadForm({
      name: lead.name,
      company: lead.company || '',
      email: lead.email || '',
      phone: lead.phone || '',
      industry: lead.industry || '',
      source: lead.source || '',
      status: lead.status as LeadStatus,
      notes: lead.notes || '',
    });
    setIsEditLeadOpen(true);
  };

  const openEditOpportunity = (opp: CrmOpportunity) => {
    setSelectedOpportunity(opp);
    setOpportunityForm({
      title: opp.title,
      description: opp.description || '',
      value: opp.value?.toString() || '',
      probability: opp.probability?.toString() || '50',
      expectedCloseDate: opp.expectedCloseDate ? new Date(opp.expectedCloseDate).toISOString().split('T')[0] : '',
      stageId: opp.stageId || '',
      clientId: opp.clientId || '',
      leadId: opp.leadId || '',
    });
    setIsEditOpportunityOpen(true);
  };

  const openEditProposal = (proposal: CrmProposal) => {
    setSelectedProposal(proposal);
    setProposalForm({
      title: proposal.title,
      description: proposal.description || '',
      opportunityId: proposal.opportunityId || '',
      clientId: proposal.clientId || '',
      partnerId: proposal.partnerId || '',
      totalValue: proposal.totalValue?.toString() || '',
      validUntil: proposal.validUntil ? new Date(proposal.validUntil).toISOString().split('T')[0] : '',
      terms: proposal.terms || '',
      notes: proposal.notes || '',
    });
    setIsEditProposalOpen(true);
  };

  const openEditContract = (contract: CrmContract) => {
    setSelectedContract(contract);
    setContractForm({
      title: contract.title,
      proposalId: contract.proposalId || '',
      opportunityId: contract.opportunityId || '',
      clientId: contract.clientId || '',
      startDate: contract.startDate ? new Date(contract.startDate).toISOString().split('T')[0] : '',
      endDate: contract.endDate ? new Date(contract.endDate).toISOString().split('T')[0] : '',
      totalValue: contract.totalValue?.toString() || '',
      terms: contract.terms || '',
    });
    setIsEditContractOpen(true);
  };

  const formatCurrency = (value: number | string | null) => {
    if (!value) return 'R$ 0,00';
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num);
  };

  if (isLoadingStages || isLoadingLeads || isLoadingOpportunities) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold" data-testid="text-page-title">CRM</h1>
          <p className="text-muted-foreground">Gerencie leads, oportunidades e pipeline de vendas</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setIsNewLeadOpen(true)} data-testid="button-new-lead">
            <UserPlus className="h-4 w-4 mr-2" />
            Novo Lead
          </Button>
          <Button variant="outline" onClick={() => setIsNewOpportunityOpen(true)} data-testid="button-new-opportunity">
            <Briefcase className="h-4 w-4 mr-2" />
            Nova Oportunidade
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Leads</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-leads">{stats?.totalLeads || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Oportunidades</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-opportunities">{stats?.totalOpportunities || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Valor do Pipeline</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-pipeline-value">
              {formatCurrency(stats?.totalPipelineValue || 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Valor Ponderado</CardTitle>
            <Percent className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-weighted-value">
              {formatCurrency(stats?.weightedPipelineValue || 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
        <TabsList>
          <TabsTrigger value="pipeline" data-testid="tab-pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="leads" data-testid="tab-leads">Leads</TabsTrigger>
          <TabsTrigger value="opportunities" data-testid="tab-opportunities">Oportunidades</TabsTrigger>
          <TabsTrigger value="proposals" data-testid="tab-proposals">Propostas</TabsTrigger>
          <TabsTrigger value="contracts" data-testid="tab-contracts">Contratos</TabsTrigger>
          <TabsTrigger value="partners" data-testid="tab-partners">Parceiros Comerciais</TabsTrigger>
        </TabsList>

        <TabsContent value="pipeline" className="mt-4">
          <div className="flex gap-4 overflow-x-auto pb-4">
            {stages.map((stage) => {
              const stageOpportunities = opportunities.filter(o => o.stageId === stage.id);
              const stageValue = stageOpportunities.reduce((sum, o) => sum + Number(o.value || 0), 0);
              
              return (
                <div key={stage.id} className="flex-shrink-0 w-72">
                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-3 h-3 rounded-full" 
                            style={{ backgroundColor: stage.color || '#6B7280' }}
                          />
                          <CardTitle className="text-sm font-medium">{stage.name}</CardTitle>
                        </div>
                        <Badge variant="secondary" size="sm">{stageOpportunities.length}</Badge>
                      </div>
                      <CardDescription className="text-xs">
                        {formatCurrency(stageValue)}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {stageOpportunities.map((opp) => (
                        <Card key={opp.id} className="p-3 hover-elevate cursor-pointer" onClick={() => openEditOpportunity(opp)}>
                          <div className="font-medium text-sm mb-1" data-testid={`text-opportunity-title-${opp.id}`}>{opp.title}</div>
                          <div className="text-sm text-muted-foreground mb-2">
                            {formatCurrency(opp.value)}
                          </div>
                          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>{opp.probability}%</span>
                            {opp.expectedCloseDate && (
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {new Date(opp.expectedCloseDate).toLocaleDateString('pt-BR')}
                              </span>
                            )}
                          </div>
                        </Card>
                      ))}
                      {stageOpportunities.length === 0 && (
                        <div className="text-center text-sm text-muted-foreground py-4">
                          Nenhuma oportunidade
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="leads" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {leads.map((lead) => (
              <Card key={lead.id} className="relative">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base" data-testid={`text-lead-name-${lead.id}`}>
                        {lead.name}
                      </CardTitle>
                      {lead.company && (
                        <CardDescription className="flex items-center gap-1 mt-1">
                          <Building2 className="h-3 w-3" />
                          {lead.company}
                        </CardDescription>
                      )}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" data-testid={`button-lead-menu-${lead.id}`}>
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEditLead(lead)}>
                          <Edit className="h-4 w-4 mr-2" />
                          Editar
                        </DropdownMenuItem>
                        {lead.status !== 'converted' && (
                          <DropdownMenuItem onClick={() => { setSelectedLead(lead); setIsConvertLeadOpen(true); }}>
                            <ArrowRight className="h-4 w-4 mr-2" />
                            Converter em Cliente
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem 
                          onClick={() => { setSelectedLead(lead); setIsDeleteLeadOpen(true); }}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Badge 
                    variant="secondary" 
                    size="sm"
                    className={leadStatusConfig[lead.status as LeadStatus]?.color}
                  >
                    {leadStatusConfig[lead.status as LeadStatus]?.label || lead.status}
                  </Badge>
                  {lead.email && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Mail className="h-3 w-3" />
                      {lead.email}
                    </div>
                  )}
                  {lead.phone && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Phone className="h-3 w-3" />
                      {lead.phone}
                    </div>
                  )}
                  {lead.industry && (
                    <div className="text-xs text-muted-foreground">
                      Setor: {lead.industry}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
            {leads.length === 0 && (
              <div className="col-span-full text-center py-12 text-muted-foreground">
                Nenhum lead cadastrado. Clique em "Novo Lead" para adicionar.
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="opportunities" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {opportunities.map((opp) => {
              const stage = stages.find(s => s.id === opp.stageId);
              const client = clients.find(c => c.id === opp.clientId);
              
              return (
                <Card key={opp.id} className="relative">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-base" data-testid={`text-opp-title-${opp.id}`}>
                          {opp.title}
                        </CardTitle>
                        {client && (
                          <CardDescription className="flex items-center gap-1 mt-1">
                            <Building2 className="h-3 w-3" />
                            {client.name}
                          </CardDescription>
                        )}
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" data-testid={`button-opp-menu-${opp.id}`}>
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditOpportunity(opp)}>
                            <Edit className="h-4 w-4 mr-2" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => { setSelectedOpportunity(opp); setIsDeleteOpportunityOpen(true); }}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-lg font-bold">{formatCurrency(opp.value)}</span>
                      <Badge variant="outline" size="sm">{opp.probability}%</Badge>
                    </div>
                    {stage && (
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-2 h-2 rounded-full" 
                          style={{ backgroundColor: stage.color || '#6B7280' }}
                        />
                        <span className="text-sm text-muted-foreground">{stage.name}</span>
                      </div>
                    )}
                    {opp.expectedCloseDate && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        Fechamento: {new Date(opp.expectedCloseDate).toLocaleDateString('pt-BR')}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
            {opportunities.length === 0 && (
              <div className="col-span-full text-center py-12 text-muted-foreground">
                Nenhuma oportunidade cadastrada. Clique em "Nova Oportunidade" para adicionar.
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="proposals" className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <h2 className="text-lg font-semibold">Propostas Comerciais</h2>
            <Button onClick={() => setIsNewProposalOpen(true)} data-testid="button-new-proposal">
              <FileText className="h-4 w-4 mr-2" />
              Nova Proposta
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {proposals.map((proposal) => {
              const client = clients.find(c => c.id === proposal.clientId);
              const opportunity = opportunities.find(o => o.id === proposal.opportunityId);
              
              return (
                <Card key={proposal.id} className="relative">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-base" data-testid={`text-proposal-title-${proposal.id}`}>
                          {proposal.title}
                        </CardTitle>
                        <CardDescription className="flex items-center gap-1 mt-1">
                          <span className="text-xs text-muted-foreground">#{proposal.number}</span>
                        </CardDescription>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" data-testid={`button-proposal-menu-${proposal.id}`}>
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditProposal(proposal)}>
                            <Edit className="h-4 w-4 mr-2" />
                            Editar
                          </DropdownMenuItem>
                          {proposal.status === 'draft' && (
                            <DropdownMenuItem onClick={() => updateProposalMutation.mutate({ id: proposal.id, data: { status: 'sent' } })}>
                              <Send className="h-4 w-4 mr-2" />
                              Enviar
                            </DropdownMenuItem>
                          )}
                          {proposal.status === 'sent' && (
                            <>
                              <DropdownMenuItem onClick={() => updateProposalMutation.mutate({ id: proposal.id, data: { status: 'approved' } })}>
                                <Check className="h-4 w-4 mr-2" />
                                Aprovar
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => updateProposalMutation.mutate({ id: proposal.id, data: { status: 'rejected' } })}>
                                <X className="h-4 w-4 mr-2" />
                                Rejeitar
                              </DropdownMenuItem>
                            </>
                          )}
                          {proposal.status === 'approved' && !proposal.projectId && (
                            <DropdownMenuItem 
                              onClick={() => convertProposalToProjectMutation.mutate(proposal.id)}
                              disabled={convertProposalToProjectMutation.isPending}
                              data-testid={`button-convert-proposal-${proposal.id}`}
                            >
                              <Briefcase className="h-4 w-4 mr-2" />
                              Criar Projeto
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem 
                            onClick={() => { setSelectedProposal(proposal); setIsDeleteProposalOpen(true); }}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Badge 
                      variant="secondary" 
                      size="sm"
                      className={proposalStatusConfig[proposal.status as ProposalStatus]?.color}
                    >
                      {proposalStatusConfig[proposal.status as ProposalStatus]?.label || proposal.status}
                    </Badge>
                    <div className="text-lg font-bold">{formatCurrency(proposal.totalValue)}</div>
                    {client && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Building2 className="h-3 w-3" />
                        {client.name}
                      </div>
                    )}
                    {opportunity && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Briefcase className="h-3 w-3" />
                        {opportunity.title}
                      </div>
                    )}
                    {proposal.validUntil && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        Válida até: {new Date(proposal.validUntil).toLocaleDateString('pt-BR')}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
            {proposals.length === 0 && (
              <div className="col-span-full text-center py-12 text-muted-foreground">
                Nenhuma proposta cadastrada. Clique em "Nova Proposta" para adicionar.
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="contracts" className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <h2 className="text-lg font-semibold">Contratos</h2>
            <Button onClick={() => setIsNewContractOpen(true)} data-testid="button-new-contract">
              <FileSignature className="h-4 w-4 mr-2" />
              Novo Contrato
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {contracts.map((contract) => {
              const client = clients.find(c => c.id === contract.clientId);
              const proposal = proposals.find(p => p.id === contract.proposalId);
              
              return (
                <Card key={contract.id} className="relative">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-base" data-testid={`text-contract-title-${contract.id}`}>
                          {contract.title}
                        </CardTitle>
                        <CardDescription className="flex items-center gap-1 mt-1">
                          <span className="text-xs text-muted-foreground">#{contract.number}</span>
                        </CardDescription>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" data-testid={`button-contract-menu-${contract.id}`}>
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditContract(contract)}>
                            <Edit className="h-4 w-4 mr-2" />
                            Editar
                          </DropdownMenuItem>
                          {contract.status === 'draft' && (
                            <DropdownMenuItem onClick={() => updateContractMutation.mutate({ id: contract.id, data: { status: 'pending_signature' } })}>
                              <Send className="h-4 w-4 mr-2" />
                              Enviar para Assinatura
                            </DropdownMenuItem>
                          )}
                          {contract.status === 'pending_signature' && (
                            <DropdownMenuItem onClick={() => updateContractMutation.mutate({ id: contract.id, data: { status: 'active' } })}>
                              <Check className="h-4 w-4 mr-2" />
                              Marcar como Assinado
                            </DropdownMenuItem>
                          )}
                          {contract.status === 'active' && (
                            <DropdownMenuItem onClick={() => updateContractMutation.mutate({ id: contract.id, data: { status: 'completed' } })}>
                              <Check className="h-4 w-4 mr-2" />
                              Concluir
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem 
                            onClick={() => { setSelectedContract(contract); setIsDeleteContractOpen(true); }}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Badge 
                      variant="secondary" 
                      size="sm"
                      className={contractStatusConfig[contract.status as ContractStatus]?.color}
                    >
                      {contractStatusConfig[contract.status as ContractStatus]?.label || contract.status}
                    </Badge>
                    <div className="text-lg font-bold">{formatCurrency(contract.totalValue)}</div>
                    {client && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Building2 className="h-3 w-3" />
                        {client.name}
                      </div>
                    )}
                    {proposal && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <FileText className="h-3 w-3" />
                        Proposta #{proposal.number}
                      </div>
                    )}
                    {contract.startDate && contract.endDate && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        {new Date(contract.startDate).toLocaleDateString('pt-BR')} - {new Date(contract.endDate).toLocaleDateString('pt-BR')}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
            {contracts.length === 0 && (
              <div className="col-span-full text-center py-12 text-muted-foreground">
                Nenhum contrato cadastrado. Clique em "Novo Contrato" para adicionar.
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="partners" className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <h2 className="text-lg font-semibold">Parceiros Comerciais</h2>
            <Button onClick={() => setIsNewPartnerOpen(true)} data-testid="button-new-partner">
              <Handshake className="h-4 w-4 mr-2" />
              Novo Parceiro Comercial
            </Button>
          </div>
          {isLoadingPartners ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {partners.map((partner) => (
                <Card key={partner.id} data-testid={`card-partner-${partner.id}`}>
                  <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base truncate">{partner.name}</CardTitle>
                      {partner.company && (
                        <CardDescription className="truncate">{partner.company}</CardDescription>
                      )}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" data-testid={`button-partner-menu-${partner.id}`}>
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => openEditPartner(partner)}
                          data-testid={`button-edit-partner-${partner.id}`}
                        >
                          <Edit className="h-4 w-4 mr-2" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => {
                            setSelectedPartner(partner);
                            setIsDeletePartnerOpen(true);
                          }}
                          className="text-destructive"
                          data-testid={`button-delete-partner-${partner.id}`}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge 
                        variant="secondary" 
                        size="sm"
                        className={partnerStatusConfig[partner.status as PartnerStatus]?.color}
                      >
                        {partnerStatusConfig[partner.status as PartnerStatus]?.label || partner.status}
                      </Badge>
                      <Badge variant="outline" size="sm">
                        {partnerTypeConfig[partner.type as PartnerType]?.label || partner.type}
                      </Badge>
                    </div>
                    {partner.email && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Mail className="h-3 w-3" />
                        {partner.email}
                      </div>
                    )}
                    {partner.phone && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Phone className="h-3 w-3" />
                        {partner.phone}
                      </div>
                    )}
                    {partner.defaultCommissionRate && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Percent className="h-3 w-3" />
                        Comissão: {partner.defaultCommissionRate}%
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
              {partners.length === 0 && (
                <div className="col-span-full text-center py-12 text-muted-foreground">
                  Nenhum parceiro comercial cadastrado. Clique em "Novo Parceiro Comercial" para adicionar.
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={isNewLeadOpen} onOpenChange={setIsNewLeadOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Lead</DialogTitle>
            <DialogDescription>Cadastre um novo lead no sistema</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome do Contato *</Label>
              <Input
                id="name"
                value={leadForm.name}
                onChange={(e) => setLeadForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Nome completo"
                data-testid="input-lead-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company">Empresa</Label>
              <Input
                id="company"
                value={leadForm.company}
                onChange={(e) => setLeadForm(prev => ({ ...prev, company: e.target.value }))}
                placeholder="Nome da empresa"
                data-testid="input-lead-company"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  value={leadForm.email}
                  onChange={(e) => setLeadForm(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="email@exemplo.com"
                  data-testid="input-lead-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Telefone</Label>
                <Input
                  id="phone"
                  value={leadForm.phone}
                  onChange={(e) => setLeadForm(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="(11) 99999-9999"
                  data-testid="input-lead-phone"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="industry">Setor</Label>
                <Input
                  id="industry"
                  value={leadForm.industry}
                  onChange={(e) => setLeadForm(prev => ({ ...prev, industry: e.target.value }))}
                  placeholder="Ex: Tecnologia"
                  data-testid="input-lead-industry"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="source">Origem</Label>
                <Input
                  id="source"
                  value={leadForm.source}
                  onChange={(e) => setLeadForm(prev => ({ ...prev, source: e.target.value }))}
                  placeholder="Ex: LinkedIn"
                  data-testid="input-lead-source"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Observações</Label>
              <Textarea
                id="notes"
                value={leadForm.notes}
                onChange={(e) => setLeadForm(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Observações sobre o lead"
                data-testid="input-lead-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsNewLeadOpen(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={() => createLeadMutation.mutate(leadForm)}
              disabled={!leadForm.name || createLeadMutation.isPending}
              data-testid="button-save-lead"
            >
              {createLeadMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditLeadOpen} onOpenChange={setIsEditLeadOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Lead</DialogTitle>
            <DialogDescription>Atualize as informações do lead</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Nome do Contato *</Label>
              <Input
                id="edit-name"
                value={leadForm.name}
                onChange={(e) => setLeadForm(prev => ({ ...prev, name: e.target.value }))}
                data-testid="input-edit-lead-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-company">Empresa</Label>
              <Input
                id="edit-company"
                value={leadForm.company}
                onChange={(e) => setLeadForm(prev => ({ ...prev, company: e.target.value }))}
                data-testid="input-edit-lead-company"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-email">E-mail</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={leadForm.email}
                  onChange={(e) => setLeadForm(prev => ({ ...prev, email: e.target.value }))}
                  data-testid="input-edit-lead-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-phone">Telefone</Label>
                <Input
                  id="edit-phone"
                  value={leadForm.phone}
                  onChange={(e) => setLeadForm(prev => ({ ...prev, phone: e.target.value }))}
                  data-testid="input-edit-lead-phone"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-status">Status</Label>
              <Select
                value={leadForm.status}
                onValueChange={(value) => setLeadForm(prev => ({ ...prev, status: value as LeadStatus }))}
              >
                <SelectTrigger data-testid="select-edit-lead-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(leadStatusConfig).map(([key, config]) => (
                    <SelectItem key={key} value={key}>{config.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-notes">Observações</Label>
              <Textarea
                id="edit-notes"
                value={leadForm.notes}
                onChange={(e) => setLeadForm(prev => ({ ...prev, notes: e.target.value }))}
                data-testid="input-edit-lead-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditLeadOpen(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={() => selectedLead && updateLeadMutation.mutate({ id: selectedLead.id, data: leadForm })}
              disabled={!leadForm.name || updateLeadMutation.isPending}
              data-testid="button-update-lead"
            >
              {updateLeadMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isNewOpportunityOpen} onOpenChange={setIsNewOpportunityOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Nova Oportunidade</DialogTitle>
            <DialogDescription>Cadastre uma nova oportunidade de negócio</DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 pr-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="opp-title">Título *</Label>
              <Input
                id="opp-title"
                value={opportunityForm.title}
                onChange={(e) => setOpportunityForm(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Nome da oportunidade"
                data-testid="input-opportunity-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="opp-client">Cliente</Label>
              <Select
                value={opportunityForm.clientId}
                onValueChange={(value) => setOpportunityForm(prev => ({ ...prev, clientId: value }))}
              >
                <SelectTrigger data-testid="select-opportunity-client">
                  <SelectValue placeholder="Selecione um cliente" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map(client => (
                    <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="opp-stage">Etapa do Pipeline *</Label>
              <Select
                value={opportunityForm.stageId}
                onValueChange={(value) => setOpportunityForm(prev => ({ ...prev, stageId: value }))}
              >
                <SelectTrigger data-testid="select-opportunity-stage">
                  <SelectValue placeholder="Selecione uma etapa" />
                </SelectTrigger>
                <SelectContent>
                  {stages.map(stage => (
                    <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="opp-value">Valor (R$)</Label>
                <Input
                  id="opp-value"
                  type="number"
                  value={opportunityForm.value}
                  onChange={(e) => setOpportunityForm(prev => ({ ...prev, value: e.target.value }))}
                  placeholder="0,00"
                  data-testid="input-opportunity-value"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="opp-probability">Probabilidade (%)</Label>
                <Input
                  id="opp-probability"
                  type="number"
                  min="0"
                  max="100"
                  value={opportunityForm.probability}
                  onChange={(e) => setOpportunityForm(prev => ({ ...prev, probability: e.target.value }))}
                  data-testid="input-opportunity-probability"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="opp-date">Previsão de Fechamento</Label>
              <Input
                id="opp-date"
                type="date"
                value={opportunityForm.expectedCloseDate}
                onChange={(e) => setOpportunityForm(prev => ({ ...prev, expectedCloseDate: e.target.value }))}
                data-testid="input-opportunity-date"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="opp-description">Descrição</Label>
              <Textarea
                id="opp-description"
                value={opportunityForm.description}
                onChange={(e) => setOpportunityForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Descrição da oportunidade"
                data-testid="input-opportunity-description"
              />
            </div>
          </div>
          </ScrollArea>
          <DialogFooter className="flex-shrink-0 pt-4">
            <Button variant="outline" onClick={() => setIsNewOpportunityOpen(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={() => createOpportunityMutation.mutate(opportunityForm)}
              disabled={!opportunityForm.title || !opportunityForm.stageId || createOpportunityMutation.isPending}
              data-testid="button-save-opportunity"
            >
              {createOpportunityMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpportunityOpen} onOpenChange={setIsEditOpportunityOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Editar Oportunidade</DialogTitle>
            <DialogDescription>Atualize as informações da oportunidade</DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 pr-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-opp-title">Título *</Label>
              <Input
                id="edit-opp-title"
                value={opportunityForm.title}
                onChange={(e) => setOpportunityForm(prev => ({ ...prev, title: e.target.value }))}
                data-testid="input-edit-opportunity-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-opp-stage">Etapa do Pipeline</Label>
              <Select
                value={opportunityForm.stageId}
                onValueChange={(value) => setOpportunityForm(prev => ({ ...prev, stageId: value }))}
              >
                <SelectTrigger data-testid="select-edit-opportunity-stage">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {stages.map(stage => (
                    <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-opp-value">Valor (R$)</Label>
                <Input
                  id="edit-opp-value"
                  type="number"
                  value={opportunityForm.value}
                  onChange={(e) => setOpportunityForm(prev => ({ ...prev, value: e.target.value }))}
                  data-testid="input-edit-opportunity-value"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-opp-probability">Probabilidade (%)</Label>
                <Input
                  id="edit-opp-probability"
                  type="number"
                  min="0"
                  max="100"
                  value={opportunityForm.probability}
                  onChange={(e) => setOpportunityForm(prev => ({ ...prev, probability: e.target.value }))}
                  data-testid="input-edit-opportunity-probability"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-opp-date">Previsão de Fechamento</Label>
              <Input
                id="edit-opp-date"
                type="date"
                value={opportunityForm.expectedCloseDate}
                onChange={(e) => setOpportunityForm(prev => ({ ...prev, expectedCloseDate: e.target.value }))}
                data-testid="input-edit-opportunity-date"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-opp-description">Descrição</Label>
              <Textarea
                id="edit-opp-description"
                value={opportunityForm.description}
                onChange={(e) => setOpportunityForm(prev => ({ ...prev, description: e.target.value }))}
                data-testid="input-edit-opportunity-description"
              />
            </div>
          </div>
          </ScrollArea>
          <DialogFooter className="flex-shrink-0 pt-4">
            <Button variant="outline" onClick={() => setIsEditOpportunityOpen(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={() => selectedOpportunity && updateOpportunityMutation.mutate({ id: selectedOpportunity.id, data: opportunityForm })}
              disabled={!opportunityForm.title || updateOpportunityMutation.isPending}
              data-testid="button-update-opportunity"
            >
              {updateOpportunityMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteLeadOpen} onOpenChange={setIsDeleteLeadOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Lead</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o lead "{selectedLead?.name}"? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedLead && deleteLeadMutation.mutate(selectedLead.id)}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete-lead"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isDeleteOpportunityOpen} onOpenChange={setIsDeleteOpportunityOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Oportunidade</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir a oportunidade "{selectedOpportunity?.title}"? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedOpportunity && deleteOpportunityMutation.mutate(selectedOpportunity.id)}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete-opportunity"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isConvertLeadOpen} onOpenChange={setIsConvertLeadOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Converter Lead em Cliente</AlertDialogTitle>
            <AlertDialogDescription>
              Deseja converter o lead "{selectedLead?.name}" em um cliente? Um novo registro de cliente será criado com as informações do lead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedLead && convertLeadMutation.mutate(selectedLead.id)}
              data-testid="button-confirm-convert-lead"
            >
              Converter
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isNewProposalOpen} onOpenChange={setIsNewProposalOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Nova Proposta</DialogTitle>
            <DialogDescription>Cadastre uma nova proposta comercial</DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 pr-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="proposal-title">Título *</Label>
              <Input
                id="proposal-title"
                value={proposalForm.title}
                onChange={(e) => setProposalForm(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Título da proposta"
                data-testid="input-proposal-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="proposal-client">Cliente</Label>
              <Select
                value={proposalForm.clientId}
                onValueChange={(value) => setProposalForm(prev => ({ ...prev, clientId: value }))}
              >
                <SelectTrigger data-testid="select-proposal-client">
                  <SelectValue placeholder="Selecione um cliente" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map(client => (
                    <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="proposal-opportunity">Oportunidade</Label>
              <Select
                value={proposalForm.opportunityId}
                onValueChange={(value) => setProposalForm(prev => ({ ...prev, opportunityId: value }))}
              >
                <SelectTrigger data-testid="select-proposal-opportunity">
                  <SelectValue placeholder="Selecione uma oportunidade" />
                </SelectTrigger>
                <SelectContent>
                  {opportunities.map(opp => (
                    <SelectItem key={opp.id} value={opp.id}>{opp.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="proposal-partner">Parceiro Comercial</Label>
              <Select
                value={proposalForm.partnerId}
                onValueChange={(value) => setProposalForm(prev => ({ ...prev, partnerId: value }))}
              >
                <SelectTrigger data-testid="select-proposal-partner">
                  <SelectValue placeholder="Selecione um parceiro comercial (opcional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Nenhum</SelectItem>
                  {partners.map(partner => (
                    <SelectItem key={partner.id} value={partner.id}>{partner.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="proposal-value">Valor (R$)</Label>
                <Input
                  id="proposal-value"
                  type="number"
                  value={proposalForm.totalValue}
                  onChange={(e) => setProposalForm(prev => ({ ...prev, totalValue: e.target.value }))}
                  data-testid="input-proposal-value"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="proposal-valid">Válida até</Label>
                <Input
                  id="proposal-valid"
                  type="date"
                  value={proposalForm.validUntil}
                  onChange={(e) => setProposalForm(prev => ({ ...prev, validUntil: e.target.value }))}
                  data-testid="input-proposal-valid"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="proposal-description">Descrição</Label>
              <Textarea
                id="proposal-description"
                value={proposalForm.description}
                onChange={(e) => setProposalForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Descrição da proposta"
                data-testid="input-proposal-description"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="proposal-terms">Termos e Condições</Label>
              <Textarea
                id="proposal-terms"
                value={proposalForm.terms}
                onChange={(e) => setProposalForm(prev => ({ ...prev, terms: e.target.value }))}
                placeholder="Termos e condições"
                data-testid="input-proposal-terms"
              />
            </div>
          </div>
          </ScrollArea>
          <DialogFooter className="flex-shrink-0 pt-4">
            <Button variant="outline" onClick={() => setIsNewProposalOpen(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={() => createProposalMutation.mutate({
                ...proposalForm,
                partnerId: proposalForm.partnerId === '_none' ? '' : proposalForm.partnerId
              })}
              disabled={!proposalForm.title || createProposalMutation.isPending}
              data-testid="button-save-proposal"
            >
              {createProposalMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditProposalOpen} onOpenChange={setIsEditProposalOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Editar Proposta</DialogTitle>
            <DialogDescription>Atualize as informações da proposta</DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 pr-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-proposal-title">Título *</Label>
              <Input
                id="edit-proposal-title"
                value={proposalForm.title}
                onChange={(e) => setProposalForm(prev => ({ ...prev, title: e.target.value }))}
                data-testid="input-edit-proposal-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-proposal-client">Cliente</Label>
              <Select
                value={proposalForm.clientId}
                onValueChange={(value) => setProposalForm(prev => ({ ...prev, clientId: value }))}
              >
                <SelectTrigger data-testid="select-edit-proposal-client">
                  <SelectValue placeholder="Selecione um cliente" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map(client => (
                    <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-proposal-partner">Parceiro Comercial</Label>
              <Select
                value={proposalForm.partnerId}
                onValueChange={(value) => setProposalForm(prev => ({ ...prev, partnerId: value }))}
              >
                <SelectTrigger data-testid="select-edit-proposal-partner">
                  <SelectValue placeholder="Selecione um parceiro comercial (opcional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Nenhum</SelectItem>
                  {partners.map(partner => (
                    <SelectItem key={partner.id} value={partner.id}>{partner.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-proposal-value">Valor (R$)</Label>
                <Input
                  id="edit-proposal-value"
                  type="number"
                  value={proposalForm.totalValue}
                  onChange={(e) => setProposalForm(prev => ({ ...prev, totalValue: e.target.value }))}
                  data-testid="input-edit-proposal-value"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-proposal-valid">Válida até</Label>
                <Input
                  id="edit-proposal-valid"
                  type="date"
                  value={proposalForm.validUntil}
                  onChange={(e) => setProposalForm(prev => ({ ...prev, validUntil: e.target.value }))}
                  data-testid="input-edit-proposal-valid"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-proposal-description">Descrição</Label>
              <Textarea
                id="edit-proposal-description"
                value={proposalForm.description}
                onChange={(e) => setProposalForm(prev => ({ ...prev, description: e.target.value }))}
                data-testid="input-edit-proposal-description"
              />
            </div>
          </div>
          </ScrollArea>
          <DialogFooter className="flex-shrink-0 pt-4">
            <Button variant="outline" onClick={() => setIsEditProposalOpen(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={() => selectedProposal && updateProposalMutation.mutate({ 
                id: selectedProposal.id, 
                data: {
                  ...proposalForm,
                  partnerId: proposalForm.partnerId === '_none' ? '' : proposalForm.partnerId
                }
              })}
              disabled={!proposalForm.title || updateProposalMutation.isPending}
              data-testid="button-update-proposal"
            >
              {updateProposalMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteProposalOpen} onOpenChange={setIsDeleteProposalOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Proposta</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir a proposta "{selectedProposal?.title}"? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedProposal && deleteProposalMutation.mutate(selectedProposal.id)}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete-proposal"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isNewContractOpen} onOpenChange={setIsNewContractOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Novo Contrato</DialogTitle>
            <DialogDescription>Cadastre um novo contrato</DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 pr-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="contract-title">Título *</Label>
              <Input
                id="contract-title"
                value={contractForm.title}
                onChange={(e) => setContractForm(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Título do contrato"
                data-testid="input-contract-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contract-client">Cliente</Label>
              <Select
                value={contractForm.clientId}
                onValueChange={(value) => setContractForm(prev => ({ ...prev, clientId: value }))}
              >
                <SelectTrigger data-testid="select-contract-client">
                  <SelectValue placeholder="Selecione um cliente" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map(client => (
                    <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="contract-proposal">Proposta</Label>
              <Select
                value={contractForm.proposalId}
                onValueChange={(value) => setContractForm(prev => ({ ...prev, proposalId: value }))}
              >
                <SelectTrigger data-testid="select-contract-proposal">
                  <SelectValue placeholder="Selecione uma proposta" />
                </SelectTrigger>
                <SelectContent>
                  {proposals.filter(p => p.status === 'approved').map(proposal => (
                    <SelectItem key={proposal.id} value={proposal.id}>{proposal.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="contract-value">Valor (R$)</Label>
              <Input
                id="contract-value"
                type="number"
                value={contractForm.totalValue}
                onChange={(e) => setContractForm(prev => ({ ...prev, totalValue: e.target.value }))}
                data-testid="input-contract-value"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="contract-start">Data Início</Label>
                <Input
                  id="contract-start"
                  type="date"
                  value={contractForm.startDate}
                  onChange={(e) => setContractForm(prev => ({ ...prev, startDate: e.target.value }))}
                  data-testid="input-contract-start"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contract-end">Data Fim</Label>
                <Input
                  id="contract-end"
                  type="date"
                  value={contractForm.endDate}
                  onChange={(e) => setContractForm(prev => ({ ...prev, endDate: e.target.value }))}
                  data-testid="input-contract-end"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="contract-terms">Termos e Condições</Label>
              <Textarea
                id="contract-terms"
                value={contractForm.terms}
                onChange={(e) => setContractForm(prev => ({ ...prev, terms: e.target.value }))}
                placeholder="Termos e condições"
                data-testid="input-contract-terms"
              />
            </div>
          </div>
          </ScrollArea>
          <DialogFooter className="flex-shrink-0 pt-4">
            <Button variant="outline" onClick={() => setIsNewContractOpen(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={() => createContractMutation.mutate(contractForm)}
              disabled={!contractForm.title || createContractMutation.isPending}
              data-testid="button-save-contract"
            >
              {createContractMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditContractOpen} onOpenChange={setIsEditContractOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Editar Contrato</DialogTitle>
            <DialogDescription>Atualize as informações do contrato</DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 pr-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-contract-title">Título *</Label>
              <Input
                id="edit-contract-title"
                value={contractForm.title}
                onChange={(e) => setContractForm(prev => ({ ...prev, title: e.target.value }))}
                data-testid="input-edit-contract-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-contract-client">Cliente</Label>
              <Select
                value={contractForm.clientId}
                onValueChange={(value) => setContractForm(prev => ({ ...prev, clientId: value }))}
              >
                <SelectTrigger data-testid="select-edit-contract-client">
                  <SelectValue placeholder="Selecione um cliente" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map(client => (
                    <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-contract-value">Valor (R$)</Label>
              <Input
                id="edit-contract-value"
                type="number"
                value={contractForm.totalValue}
                onChange={(e) => setContractForm(prev => ({ ...prev, totalValue: e.target.value }))}
                data-testid="input-edit-contract-value"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-contract-start">Data Início</Label>
                <Input
                  id="edit-contract-start"
                  type="date"
                  value={contractForm.startDate}
                  onChange={(e) => setContractForm(prev => ({ ...prev, startDate: e.target.value }))}
                  data-testid="input-edit-contract-start"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-contract-end">Data Fim</Label>
                <Input
                  id="edit-contract-end"
                  type="date"
                  value={contractForm.endDate}
                  onChange={(e) => setContractForm(prev => ({ ...prev, endDate: e.target.value }))}
                  data-testid="input-edit-contract-end"
                />
              </div>
            </div>
          </div>
          </ScrollArea>
          <DialogFooter className="flex-shrink-0 pt-4">
            <Button variant="outline" onClick={() => setIsEditContractOpen(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={() => selectedContract && updateContractMutation.mutate({ id: selectedContract.id, data: contractForm })}
              disabled={!contractForm.title || updateContractMutation.isPending}
              data-testid="button-update-contract"
            >
              {updateContractMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteContractOpen} onOpenChange={setIsDeleteContractOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Contrato</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o contrato "{selectedContract?.title}"? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedContract && deleteContractMutation.mutate(selectedContract.id)}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete-contract"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isNewPartnerOpen} onOpenChange={setIsNewPartnerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Parceiro Comercial</DialogTitle>
            <DialogDescription>Cadastre um novo parceiro comercial no CRM</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="partner-name">Nome *</Label>
              <Input
                id="partner-name"
                value={partnerForm.name}
                onChange={(e) => setPartnerForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Nome do parceiro"
                data-testid="input-partner-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="partner-company">Empresa</Label>
              <Input
                id="partner-company"
                value={partnerForm.company}
                onChange={(e) => setPartnerForm(prev => ({ ...prev, company: e.target.value }))}
                placeholder="Nome da empresa"
                data-testid="input-partner-company"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="partner-email">E-mail</Label>
                <Input
                  id="partner-email"
                  type="email"
                  value={partnerForm.email}
                  onChange={(e) => setPartnerForm(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="email@exemplo.com"
                  data-testid="input-partner-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="partner-phone">Telefone</Label>
                <Input
                  id="partner-phone"
                  value={partnerForm.phone}
                  onChange={(e) => setPartnerForm(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="(11) 99999-9999"
                  data-testid="input-partner-phone"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="partner-type">Tipo *</Label>
                <Select
                  value={partnerForm.type}
                  onValueChange={(value) => setPartnerForm(prev => ({ ...prev, type: value as PartnerType }))}
                >
                  <SelectTrigger data-testid="select-partner-type">
                    <SelectValue placeholder="Selecione o tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="referral">Indicador</SelectItem>
                    <SelectItem value="service">Serviços</SelectItem>
                    <SelectItem value="reseller">Revendedor</SelectItem>
                    <SelectItem value="affiliate">Afiliado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="partner-status">Status</Label>
                <Select
                  value={partnerForm.status}
                  onValueChange={(value) => setPartnerForm(prev => ({ ...prev, status: value as PartnerStatus }))}
                >
                  <SelectTrigger data-testid="select-partner-status">
                    <SelectValue placeholder="Selecione o status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pendente</SelectItem>
                    <SelectItem value="active">Ativo</SelectItem>
                    <SelectItem value="inactive">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="partner-commission">Comissão Padrão (%)</Label>
              <Input
                id="partner-commission"
                type="number"
                value={partnerForm.defaultCommissionRate}
                onChange={(e) => setPartnerForm(prev => ({ ...prev, defaultCommissionRate: e.target.value }))}
                placeholder="10"
                data-testid="input-partner-commission"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="partner-notes">Observações</Label>
              <Textarea
                id="partner-notes"
                value={partnerForm.notes}
                onChange={(e) => setPartnerForm(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Observações sobre o parceiro"
                data-testid="input-partner-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsNewPartnerOpen(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={() => createPartnerMutation.mutate(partnerForm)}
              disabled={!partnerForm.name || createPartnerMutation.isPending}
              data-testid="button-save-partner"
            >
              {createPartnerMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditPartnerOpen} onOpenChange={setIsEditPartnerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Parceiro Comercial</DialogTitle>
            <DialogDescription>Atualize as informações do parceiro comercial</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-partner-name">Nome *</Label>
              <Input
                id="edit-partner-name"
                value={partnerForm.name}
                onChange={(e) => setPartnerForm(prev => ({ ...prev, name: e.target.value }))}
                data-testid="input-edit-partner-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-partner-company">Empresa</Label>
              <Input
                id="edit-partner-company"
                value={partnerForm.company}
                onChange={(e) => setPartnerForm(prev => ({ ...prev, company: e.target.value }))}
                data-testid="input-edit-partner-company"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-partner-email">E-mail</Label>
                <Input
                  id="edit-partner-email"
                  type="email"
                  value={partnerForm.email}
                  onChange={(e) => setPartnerForm(prev => ({ ...prev, email: e.target.value }))}
                  data-testid="input-edit-partner-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-partner-phone">Telefone</Label>
                <Input
                  id="edit-partner-phone"
                  value={partnerForm.phone}
                  onChange={(e) => setPartnerForm(prev => ({ ...prev, phone: e.target.value }))}
                  data-testid="input-edit-partner-phone"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-partner-type">Tipo *</Label>
                <Select
                  value={partnerForm.type}
                  onValueChange={(value) => setPartnerForm(prev => ({ ...prev, type: value as PartnerType }))}
                >
                  <SelectTrigger data-testid="select-edit-partner-type">
                    <SelectValue placeholder="Selecione o tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="referral">Indicador</SelectItem>
                    <SelectItem value="service">Serviços</SelectItem>
                    <SelectItem value="reseller">Revendedor</SelectItem>
                    <SelectItem value="affiliate">Afiliado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-partner-status">Status</Label>
                <Select
                  value={partnerForm.status}
                  onValueChange={(value) => setPartnerForm(prev => ({ ...prev, status: value as PartnerStatus }))}
                >
                  <SelectTrigger data-testid="select-edit-partner-status">
                    <SelectValue placeholder="Selecione o status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pendente</SelectItem>
                    <SelectItem value="active">Ativo</SelectItem>
                    <SelectItem value="inactive">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-partner-commission">Comissão Padrão (%)</Label>
              <Input
                id="edit-partner-commission"
                type="number"
                value={partnerForm.defaultCommissionRate}
                onChange={(e) => setPartnerForm(prev => ({ ...prev, defaultCommissionRate: e.target.value }))}
                data-testid="input-edit-partner-commission"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-partner-notes">Observações</Label>
              <Textarea
                id="edit-partner-notes"
                value={partnerForm.notes}
                onChange={(e) => setPartnerForm(prev => ({ ...prev, notes: e.target.value }))}
                data-testid="input-edit-partner-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditPartnerOpen(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={() => selectedPartner && updatePartnerMutation.mutate({ id: selectedPartner.id, data: partnerForm })}
              disabled={!partnerForm.name || updatePartnerMutation.isPending}
              data-testid="button-update-partner"
            >
              {updatePartnerMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeletePartnerOpen} onOpenChange={setIsDeletePartnerOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Parceiro Comercial</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o parceiro comercial "{selectedPartner?.name}"? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedPartner && deletePartnerMutation.mutate(selectedPartner.id)}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete-partner"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
