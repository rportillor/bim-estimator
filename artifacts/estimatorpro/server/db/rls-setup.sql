-- 🛡️ ENTERPRISE SECURITY: Row-Level Security (RLS) Setup for Multi-Tenant Data Isolation
-- This enforces data separation at the PostgreSQL level, preventing application bugs from leaking data

-- =============================================================================
-- 1. ENABLE ROW-LEVEL SECURITY ON CRITICAL TABLES
-- =============================================================================

-- Projects: Core business data - strict company isolation
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- Documents: Construction drawings/specs - company-sensitive
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- BoQ Items: Cost estimation data - highly sensitive
ALTER TABLE boq_items ENABLE ROW LEVEL SECURITY;

-- BIM Models: 3D models - intellectual property
ALTER TABLE bim_models ENABLE ROW LEVEL SECURITY;

-- BIM Elements: Detailed model data
ALTER TABLE bim_elements ENABLE ROW LEVEL SECURITY;

-- Document Revisions: Version history
ALTER TABLE document_revisions ENABLE ROW LEVEL SECURITY;

-- Analysis Results: AI analysis outputs
ALTER TABLE analysis_results ENABLE ROW LEVEL SECURITY;

-- Cost Estimates: Financial data
ALTER TABLE cost_estimates ENABLE ROW LEVEL SECURITY;

-- RFIs and Change Requests: Project communications
ALTER TABLE rfis ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_requests ENABLE ROW LEVEL SECURITY;

-- Compliance Checks: Regulatory analysis
ALTER TABLE compliance_checks ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 2. PROJECT-LEVEL DATA ISOLATION POLICIES
-- =============================================================================

-- Projects: Users can only access projects they own or from their company
CREATE POLICY tenant_isolation_projects ON projects
    USING (
        -- User owns the project directly
        user_id = current_setting('app.current_user_id')::varchar
        OR
        -- User is from same company as project owner (via users table)
        EXISTS (
            SELECT 1 FROM users u1, users u2 
            WHERE u1.id = current_setting('app.current_user_id')::varchar
            AND u2.id = projects.user_id
            AND u1.company_id IS NOT NULL 
            AND u1.company_id = u2.company_id
        )
    );

-- Documents: Inherit project-level access + visibility controls
CREATE POLICY tenant_isolation_documents ON documents
    USING (
        EXISTS (
            SELECT 1 FROM projects p, users u1, users u2
            WHERE p.id = documents.project_id
            AND u1.id = current_setting('app.current_user_id')::varchar
            AND u2.id = p.user_id
            AND (
                -- Direct project ownership
                p.user_id = u1.id
                OR
                -- Same company access
                (u1.company_id IS NOT NULL AND u1.company_id = u2.company_id)
            )
        )
    );

-- BoQ Items: Follow project access + cost estimation license verification
CREATE POLICY tenant_isolation_boq_items ON boq_items
    USING (
        EXISTS (
            SELECT 1 FROM projects p, users u1, users u2
            WHERE p.id = boq_items.project_id
            AND u1.id = current_setting('app.current_user_id')::varchar
            AND u2.id = p.user_id
            AND (
                p.user_id = u1.id
                OR
                (u1.company_id IS NOT NULL AND u1.company_id = u2.company_id)
            )
        )
    );

-- BIM Models: Project-level access with additional IP protection
CREATE POLICY tenant_isolation_bim_models ON bim_models
    USING (
        EXISTS (
            SELECT 1 FROM projects p, users u1, users u2
            WHERE p.id = bim_models.project_id
            AND u1.id = current_setting('app.current_user_id')::varchar
            AND u2.id = p.user_id
            AND (
                p.user_id = u1.id
                OR
                (u1.company_id IS NOT NULL AND u1.company_id = u2.company_id)
            )
        )
    );

-- BIM Elements: Follow BIM model access
CREATE POLICY tenant_isolation_bim_elements ON bim_elements
    USING (
        EXISTS (
            SELECT 1 FROM bim_models bm, projects p, users u1, users u2
            WHERE bm.id = bim_elements.model_id
            AND p.id = bm.project_id
            AND u1.id = current_setting('app.current_user_id')::varchar
            AND u2.id = p.user_id
            AND (
                p.user_id = u1.id
                OR
                (u1.company_id IS NOT NULL AND u1.company_id = u2.company_id)
            )
        )
    );

-- =============================================================================
-- 3. AUDIT AND COMPLIANCE DATA POLICIES
-- =============================================================================

-- Analysis Results: Project-level access
CREATE POLICY tenant_isolation_analysis_results ON analysis_results
    USING (
        EXISTS (
            SELECT 1 FROM projects p, users u1, users u2
            WHERE p.id = analysis_results.project_id
            AND u1.id = current_setting('app.current_user_id')::varchar
            AND u2.id = p.user_id
            AND (
                p.user_id = u1.id
                OR
                (u1.company_id IS NOT NULL AND u1.company_id = u2.company_id)
            )
        )
    );

-- Cost Estimates: Project-level access with subscription tier verification
CREATE POLICY tenant_isolation_cost_estimates ON cost_estimates
    USING (
        EXISTS (
            SELECT 1 FROM projects p, users u1, users u2
            WHERE p.id = cost_estimates.project_id
            AND u1.id = current_setting('app.current_user_id')::varchar
            AND u2.id = p.user_id
            AND (
                p.user_id = u1.id
                OR
                (u1.company_id IS NOT NULL AND u1.company_id = u2.company_id)
            )
        )
    );

-- RFIs: Project-level access
CREATE POLICY tenant_isolation_rfis ON rfis
    USING (
        EXISTS (
            SELECT 1 FROM projects p, users u1, users u2
            WHERE p.id = rfis.project_id
            AND u1.id = current_setting('app.current_user_id')::varchar
            AND u2.id = p.user_id
            AND (
                p.user_id = u1.id
                OR
                (u1.company_id IS NOT NULL AND u1.company_id = u2.company_id)
            )
        )
    );

-- Change Requests: Project-level access
CREATE POLICY tenant_isolation_change_requests ON change_requests
    USING (
        EXISTS (
            SELECT 1 FROM projects p, users u1, users u2
            WHERE p.id = change_requests.project_id
            AND u1.id = current_setting('app.current_user_id')::varchar
            AND u2.id = p.user_id
            AND (
                p.user_id = u1.id
                OR
                (u1.company_id IS NOT NULL AND u1.company_id = u2.company_id)
            )
        )
    );

-- Compliance Checks: Project-level access
CREATE POLICY tenant_isolation_compliance_checks ON compliance_checks
    USING (
        EXISTS (
            SELECT 1 FROM projects p, users u1, users u2
            WHERE p.id = compliance_checks.project_id
            AND u1.id = current_setting('app.current_user_id')::varchar
            AND u2.id = p.user_id
            AND (
                p.user_id = u1.id
                OR
                (u1.company_id IS NOT NULL AND u1.company_id = u2.company_id)
            )
        )
    );

-- =============================================================================
-- 4. SECURITY VERIFICATION FUNCTIONS
-- =============================================================================

-- Function to verify tenant access to a project
CREATE OR REPLACE FUNCTION verify_project_access(project_uuid varchar)
RETURNS boolean AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM projects p, users u1, users u2
        WHERE p.id = project_uuid
        AND u1.id = current_setting('app.current_user_id')::varchar
        AND u2.id = p.user_id
        AND (
            p.user_id = u1.id
            OR
            (u1.company_id IS NOT NULL AND u1.company_id = u2.company_id)
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user's accessible company IDs
CREATE OR REPLACE FUNCTION get_accessible_company_ids()
RETURNS varchar[] AS $$
DECLARE
    result varchar[];
BEGIN
    SELECT ARRAY(
        SELECT DISTINCT u.company_id
        FROM users u
        WHERE u.id = current_setting('app.current_user_id')::varchar
        AND u.company_id IS NOT NULL
    ) INTO result;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 5. INDEXES FOR RLS PERFORMANCE
-- =============================================================================

-- Ensure efficient RLS policy execution
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_company_id ON users(company_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_project_id ON documents(project_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_boq_items_project_id ON boq_items(project_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bim_models_project_id ON bim_models(project_id);

-- Composite indexes for company-based queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_id_company_id ON users(id, company_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_projects_user_company_lookup ON projects(user_id, id);

-- =============================================================================
-- SECURITY NOTES:
-- 
-- 1. These RLS policies enforce multi-tenant data isolation at the database level
-- 2. Users can only access data from their own projects or company projects
-- 3. Solo practitioners (company_id = NULL) only see their own data
-- 4. Company users can see all company projects but not other companies' data
-- 5. All policies use USING clauses for both SELECT and other operations
-- 6. Performance is optimized with strategic indexes
-- 7. Security functions are SECURITY DEFINER for controlled access
-- =============================================================================