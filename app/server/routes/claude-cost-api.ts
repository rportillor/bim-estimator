import { Router } from 'express';
import { claudeCostMonitor } from '../services/claude-cost-monitor';

const router = Router();

/**
 * Get current usage statistics
 */
router.get('/claude-usage/current', async (req, res) => {
  try {
    const todaysUsage = await claudeCostMonitor.getTodaysUsage();
    res.json({
      success: true,
      data: todaysUsage
    });
  } catch (error) {
    console.error('Error getting current usage:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get current usage' 
    });
  }
});

/**
 * Get comprehensive usage report
 */
router.get('/claude-usage/report', async (req, res) => {
  try {
    const report = await claudeCostMonitor.getUsageReport();
    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    console.error('Error getting usage report:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get usage report' 
    });
  }
});

/**
 * Set daily budget limit
 */
router.post('/claude-usage/budget', async (req, res) => {
  try {
    const { limit } = req.body;
    
    if (!limit || typeof limit !== 'number' || limit <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid budget limit is required'
      });
    }

    claudeCostMonitor.setDailyLimit(limit);
    
    res.json({
      success: true,
      message: `Daily budget limit set to $${limit}`
    });
  } catch (error) {
    console.error('Error setting budget limit:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to set budget limit' 
    });
  }
});

/**
 * Reset cost monitoring (emergency override)
 */
router.post('/claude-usage/reset', async (req, res) => {
  try {
    claudeCostMonitor.resetMonitoring();
    
    res.json({
      success: true,
      message: 'Cost monitoring reset successfully'
    });
  } catch (error) {
    console.error('Error resetting monitoring:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to reset monitoring' 
    });
  }
});

/**
 * Emergency stop - disable all Claude API calls
 */
router.post('/claude-usage/emergency-stop', async (req, res) => {
  try {
    claudeCostMonitor.emergencyStop();
    
    res.json({
      success: true,
      message: 'Emergency stop activated - all Claude API calls disabled'
    });
  } catch (error) {
    console.error('Error activating emergency stop:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to activate emergency stop' 
    });
  }
});

export default router;