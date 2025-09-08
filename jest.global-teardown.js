// LIQUID ABT - Jest Global Teardown

// Note: Jest will handle the TypeScript compilation
const path = require('path')

// Function to load TestDatabaseUtils dynamically
async function loadTestUtils() {
  try {
    // Try to require the compiled version
    const { TestDatabaseUtils } = require('./__tests__/utils/database')
    return TestDatabaseUtils
  } catch (error) {
    console.warn('Could not load TestDatabaseUtils, cleanup will be limited')
    return null
  }
}

module.exports = async () => {
  console.log('🧹 Starting global test environment cleanup...')
  
  const TestDatabaseUtils = await loadTestUtils()
  
  if (!TestDatabaseUtils) {
    console.log('⚠️  TestDatabaseUtils not available, skipping database cleanup')
    return
  }
  
  try {
    // Clean up all test databases and schemas
    await TestDatabaseUtils.cleanup()
    
    // Disconnect from database
    await TestDatabaseUtils.disconnect()
    
    console.log('✅ Test environment cleanup complete')
  } catch (error) {
    console.error('❌ Test environment cleanup failed:', error.message)
    
    // Attempt force cleanup as last resort
    try {
      await TestDatabaseUtils.forceGlobalCleanup()
      await TestDatabaseUtils.disconnect()
      console.log('✅ Force cleanup completed')
    } catch (forceError) {
      console.error('❌ Force cleanup also failed:', forceError.message)
    }
  }
}