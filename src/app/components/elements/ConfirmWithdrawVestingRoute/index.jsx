import React from 'react';
import PropTypes from 'prop-types';
import tt from 'counterpart';

const ConfirmWithdrawVestingRoute = ({ operation }) => {
    const { from, to, percentage, asset } = operation;

    const getAssetLabel = (isAutoVest) => {
        return isAutoVest ? tt('advanced_routes.steem_power') : tt('advanced_routes.steem');
    };

    return (
        <div className="info">
            <div className="input-group">
                <span className="input-group-label" style={{ textTransform: 'capitalize' }}>
                    {tt('advanced_routes.from')}
                </span>
                <input
                    className="input-group-field"
                    type="text"
                    value={from}
                    disabled={true}
                />
            </div>
            <div className="input-group">
                <span className="input-group-label" style={{ textTransform: 'capitalize' }}>
                    {tt('advanced_routes.to')}
                </span>
                <input
                    className="input-group-field"
                    type="text"
                    value={to}
                    disabled={true}
                />
            </div>
            <div className="input-group">
                <span className="input-group-label" style={{ textTransform: 'capitalize' }}>
                    {tt('advanced_routes.percentage')}
                </span>
                <input
                    className="input-group-field"
                    type="text"
                    value={`${percentage}%`}
                    disabled={true}
                />
                <input
                    className="input-group-field"
                    type="text"
                    value={getAssetLabel(asset)}
                    disabled={true}
                />
            </div>
        </div>
    );
};

ConfirmWithdrawVestingRoute.propTypes = {
    operation: PropTypes.shape({
        from: PropTypes.string.isRequired,
        to: PropTypes.string.isRequired,
        percentage: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
        asset: PropTypes.bool.isRequired,
    }).isRequired,
};

export default ConfirmWithdrawVestingRoute;
