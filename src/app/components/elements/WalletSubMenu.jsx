import React from 'react';
import { Link } from 'react-router';
import tt from 'counterpart';

export default ({ accountname, isMyAccount, showTab }) => {
    return (
        <ul className="WalletSubMenu menu">
            {(isMyAccount || showTab == 'balance') && (
                <li>
                    <Link
                        to={`/@${accountname}/transfers`}
                        activeClassName="active"
                    >
                        {tt('g.balances')}
                    </Link>
                </li>
            )}
            {isMyAccount || showTab == 'permissions' ? (
                <li>
                    <Link
                        to={`/@${accountname}/permissions`}
                        activeClassName="active"
                    >
                        {tt('g.permissions')}
                    </Link>
                </li>
            ) : null}
            {isMyAccount || showTab == 'password' ? (
                <li>
                    <Link
                        to={`/@${accountname}/password`}
                        activeClassName="active"
                    >
                        {tt('g.change_password')}
                    </Link>
                </li>
            ) : null}
            {isMyAccount || showTab == 'communities' ? (
                <li>
                    <Link
                        to={`/@${accountname}/communities`}
                        activeClassName="active"
                    >
                        {tt('g.communities')}
                    </Link>
                </li>
            ) : null}
        </ul>
    );
};
