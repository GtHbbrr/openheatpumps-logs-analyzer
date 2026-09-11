-- Toekomstbestendig D1 SQL Schema voor de MVP
CREATE TABLE IF NOT EXISTS openquatt_mvp_profiles (
    id TEXT PRIMARY KEY,                        -- Unieke UUID per sessie/test
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    -- Handmatige verrijking door gebruiker via de eenvoudige knoppen
    woning_type TEXT,                           -- Bijv. 'tussenwoning', 'vrijstaand'
    afgiftesysteem TEXT,                        -- Bijv. 'radiatoren', 'fancoils', 'vloer'
    cv_ketel TEXT,                              -- Bijv. 'Intergas', 'Remeha'
    thermostaat TEXT,                           -- Bijv. 'Nest', 'Tado'
    
    -- Flexibele log-metagegevens van OpenQuatt
    firmware_version TEXT,                      -- Uit 'projectVersionText'
    hardware_profile TEXT,                      -- Uit 'hardwareProfileText' (bijv. Q-edition)
    raw_log_json TEXT                           -- De .oqdebug JSON als flexibele text-blob
);
